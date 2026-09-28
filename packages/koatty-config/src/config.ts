/*
 * @Description: 
 * @Usage: 
 * @Author: richen
 * @Date: 2022-02-18 11:19:55
 * @LastEditTime: 2024-11-06 14:14:20
 */
import { IOCContainer, TAGGED_ARGS } from "koatty_container";
import * as Helper from "koatty_lib";
import { resolveProfileName } from "koatty_core";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { ConfigSchema, isJsonSchema, validateConfig } from "./validator";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const ENC_PREFIX = "ENC(AES256:";
const ENC_SUFFIX = ")";

function getEncryptionKey(): Buffer | null {
  const keyEnv = process.env.KOATTY_CONFIG_KEY;
  if (!keyEnv) return null;
  return scryptSync(keyEnv, "koatty-config-salt", 32);
}

export function encrypt(plaintext: string, key?: Buffer): string {
  const derivedKey = key || getEncryptionKey();
  if (!derivedKey) throw new Error("KOATTY_CONFIG_KEY environment variable is required for encryption");
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  return `${ENC_PREFIX}${payload}${ENC_SUFFIX}`;
}

export function decrypt(encryptedValue: string, key?: Buffer): string {
  if (!encryptedValue.startsWith(ENC_PREFIX) || !encryptedValue.endsWith(ENC_SUFFIX)) return encryptedValue;
  const derivedKey = key || getEncryptionKey();
  if (!derivedKey) throw new Error("KOATTY_CONFIG_KEY environment variable is required for decryption");
  const payload = encryptedValue.slice(ENC_PREFIX.length, -ENC_SUFFIX.length);
  const data = Buffer.from(payload, "base64");
  const MIN_PAYLOAD_LENGTH = IV_LENGTH + 16 + 1;
  if (data.length < MIN_PAYLOAD_LENGTH) {
    throw new Error(`Invalid encrypted payload: too short (${data.length} bytes, minimum ${MIN_PAYLOAD_LENGTH})`);
  }
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = data.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  try {
    return decipher.update(encrypted) + decipher.final("utf8");
  } catch {
    throw new Error("Failed to decrypt config value. Check KOATTY_CONFIG_KEY.");
  }
}

function decryptConfigValues(conf: any, parentPath = ""): void {
  if (!conf || typeof conf !== "object") return;
  for (const k of Object.keys(conf)) {
    const currentPath = parentPath ? `${parentPath}.${k}` : k;
    try {
      if (typeof conf[k] === "string" && conf[k].startsWith(ENC_PREFIX) && conf[k].endsWith(ENC_SUFFIX)) {
        conf[k] = decrypt(conf[k]);
      } else if (typeof conf[k] === "object" && conf[k] !== null) {
        decryptConfigValues(conf[k], currentPath);
      }
    } catch (err) {
      throw new Error(`Failed to decrypt config key '${currentPath}': ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
import { Load } from "koatty_loader";
import * as path from "path";
const rc = require("run-con");
/**
 * LoadConfigs
 *
 * @export
 * @param {string[]} loadPath
 * @param {string} [baseDir]
 * @param {string[]} [pattern]
 * @param {string[]} [ignore]
 * @param {ValidationSchema} [schema] Optional configuration schema. When provided,
 *        defaults from the schema are applied first, then the loaded config is
 *        validated. Validation failure throws `Configuration validation failed`
 *        with one line per offending field path (COR-08).
 * @returns {*}
 */
export function LoadConfigs(loadPath: string[], baseDir?: string, pattern?: string[], ignore?: string[], schema?: ConfigSchema,
  runtime?: {manifestFile: string; baseDir: string}) {
  const conf: Record<string, any> = {};
  const env = process.env.KOATTY_ENV || process.env.NODE_ENV || "";

  const directories = runtime ? loadPath.map(dir => path.resolve(baseDir ?? process.cwd(), dir)) : loadPath;
  Load(directories, runtime?.baseDir ?? baseDir, (name: string, path: string, exp: any) => {
    let tempConf: any = {};
    // deep-clone: parseEnv must never mutate the required module's exports,
    // otherwise a second LoadConfigs call sees pre-interpolated values (COR-08)
    const loaded = Helper.isObject(exp) ? Helper.clone(exp, true) : exp;
    if (name.includes("_")) {
      const t = name.slice(name.lastIndexOf("_") + 1);
      if (t && env.startsWith(t)) {
        name = name.replace(`_${t}`, "");
        tempConf = rc(name, { [name]: loaded });
      }
    } else {
      tempConf = rc(name, { [name]: loaded });
    }
    conf[name] = tempConf[name];
  }, pattern, ignore, runtime ? {manifestFile: runtime.manifestFile} : undefined);

  // Resolve the profile after all environment overlays have been merged, before interpolation.
  const explicit = conf.security?.profile ?? conf.config?.security?.profile;
  const profile = explicit === undefined ? resolveProfileName() : parseEnv({ profile: explicit }, true).profile;
  if (!['strict', 'standard', 'development'].includes(profile)) throw new Error(`Unknown security profile: ${profile}`);
  parseEnv(conf, profile === 'strict');
  decryptConfigValues(conf);

  if (schema !== undefined) {
    // apply schema defaults before validation
    for (const [key, rule] of Object.entries(isJsonSchema(schema) ? {} : schema)) {
      if (rule && rule.default !== undefined && conf[key] === undefined) {
        conf[key] = rule.default;
      }
    }
    const result = validateConfig(conf, schema);
    if (!result.valid) {
      const details = result.errors.map(e => `  - ${e.path}: ${e.message}`).join("\n");
      throw new Error(`Configuration validation failed:\n${details}`);
    }
  }

  return conf;
}

/**
 * Environment variable reference: `${VAR}` or `${VAR:-default}`.
 * Both whole-string references and embedded interpolation are supported.
 */
const ENV_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

/**
 * Replace `${VAR}` / `${VAR:-default}` references in a string with environment
 * values. When the variable is undefined and has no default:
 * - strict profile (production): throws (fail-closed, COR-06/C-6);
 * - otherwise: replaced with an empty string (legacy behavior).
 *
 * @param {*} conf
 * @returns {*}
 */
function parseEnv(conf: any, isStrict = resolveProfileName() === "strict") {
  if (!conf || typeof conf !== "object") return conf;
  Object.keys(conf).forEach(key => {
    const element = conf[key];
    if (element && typeof element === "object") {
      conf[key] = parseEnv(element, isStrict);
    } else if (Helper.isString(element) && element.includes("${")) {
      conf[key] = element.replace(ENV_VAR_RE, (match: string, name: string, def?: string) => {
        const value = process.env[name];
        if (value !== undefined && value !== "") return value;
        if (def !== undefined) return def;
        if (value !== undefined) return value;
        if (isStrict) {
          throw new Error(
            `Configuration environment variable '${name}' is not set and has no default value (referenced by '${match}')`
          );
        }
        return "";
      });
    }
  });
  return conf;
}

/**
 * Indicates that an decorated configuration as a property.
 *
 * @export
 * @param {string} identifier configuration key
 * @param {string} [type] configuration type
 * @returns {PropertyDecorator}
 */
export function Config(key?: string, type?: string) {
  const register = (target: object, propertyKey: string | symbol) => {
    const configKey = key || String(propertyKey);
    IOCContainer.savePropertyData(TAGGED_ARGS, {
      name: propertyKey,
      method: function (this: { app?: any } | undefined) {
        const app = this?.app ?? IOCContainer.getApp();
        return app?.config ? app.config(configKey, type || "config") : null;
      }
    }, target, propertyKey);
  };
  return IOCContainer.createDecorator({
    legacy: register,
    tc39: (context: any) => {
      context.addInitializer(function (this: object) {
        register(Object.getPrototypeOf(this), context.name);
      });
    }
  }, 'field');
}
