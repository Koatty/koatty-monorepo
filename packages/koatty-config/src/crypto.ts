import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const ENC_PREFIX = 'ENC(AES256:';
const ENC_SUFFIX = ')';

export function getEncryptionKey(): Buffer {
  const keyEnv = process.env.KOATTY_CONFIG_KEY;
  if (!keyEnv) {
    return null as any;
  }
  return scryptSync(keyEnv, 'koatty-salt', 32);
}

export function encrypt(plaintext: string, key?: Buffer): string {
  const derivedKey = key || getEncryptionKey();
  if (!derivedKey) {
    throw new Error('KOATTY_CONFIG_KEY environment variable is required for encryption');
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return `${ENC_PREFIX}${payload}${ENC_SUFFIX}`;
}

export function decrypt(encryptedValue: string, key?: Buffer): string {
  const derivedKey = key || getEncryptionKey();
  if (!derivedKey) {
    throw new Error('KOATTY_CONFIG_KEY environment variable is required for decryption');
  }
  if (!encryptedValue.startsWith(ENC_PREFIX) || !encryptedValue.endsWith(ENC_SUFFIX)) {
    return encryptedValue;
  }
  const payload = encryptedValue.slice(ENC_PREFIX.length, -ENC_SUFFIX.length);
  const data = Buffer.from(payload, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

export function decryptConfig(config: any, key?: Buffer): any {
  if (typeof config === 'string') {
    if (config.startsWith(ENC_PREFIX) && config.endsWith(ENC_SUFFIX)) {
      return decrypt(config, key);
    }
    return config;
  }
  if (Array.isArray(config)) {
    return config.map(item => decryptConfig(item, key));
  }
  if (config && typeof config === 'object') {
    const result: any = {};
    for (const [k, v] of Object.entries(config)) {
      result[k] = decryptConfig(v, key);
    }
    return result;
  }
  return config;
}
