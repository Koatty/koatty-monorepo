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
import { ValidationSchema, validateConfig } from "./validator";

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
export function LoadConfigs(loadPath: string[], baseDir?: string, pattern?: string[], ignore?: string[], schema?: ValidationSchema) {
  const conf: Record<string, any> = {};
  const env = process.env.KOATTY_ENV || process.env.NODE_ENV || "";

  Load(loadPath, baseDir, (name: string, path: string, exp: any) => {
    let tempConf: any = {};
    // deep-clone: parseEnv must never mutate the required module's exports,
    // otherwise a second LoadConfigs call sees pre-interpolated values (COR-08)
    const loaded = Helper.isObject(exp) ? Helper.clone(exp, true) : exp;
    if (name.includes("_")) {
      const t = name.slice(name.lastIndexOf("_") + 1);
      if (t && env.startsWith(t)) {
        name = name.replace(`_${t}`, "");
        tempConf = rc(name, { [name]: parseEnv(loaded) });
      }
    } else {
      tempConf = rc(name, { [name]: parseEnv(loaded) });
    }
    conf[name] = tempConf[name];
  }, pattern, ignore);

  decryptConfigValues(conf);

  if (schema && Helper.isObject(schema)) {
    // apply schema defaults before validation
    for (const [key, rule] of Object.entries(schema)) {
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
function parseEnv(conf: any) {
  if (!Helper.isObject(conf)) return conf;
  const isStrict = resolveProfileName() === "strict";
  Object.keys(conf).forEach(key => {
    const element = conf[key];
    if (Helper.isObject(element)) {
      conf[key] = parseEnv(element);
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
export function Config(key?: string, type?: string): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const propName = typeof propertyKey === 'symbol' ? propertyKey.toString() : propertyKey;
    IOCContainer.savePropertyData(TAGGED_ARGS, {
      name: propertyKey,
      method: () => {
        const app = IOCContainer.getApp();
        if (!app?.config) {
          return null;
        }
        key = key || propName;
        type = type || "config";
        return app.config(key, type);
      }
    }, target, propertyKey);
  };
}
