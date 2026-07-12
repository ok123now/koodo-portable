"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VAULT_VERSION = 1;
const VAULT_AAD = "koodo-portable-credential-vault:v1";
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keyLength: 32 });
const MAX_CREDENTIAL_SIZE = 64 * 1024;
const MAX_CREDENTIALS = 256;

class CredentialVaultError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CredentialVaultError";
    this.code = code;
  }
}

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const decodeBase64 = (value, field, expectedLength) => {
  if (typeof value !== "string" || !value) {
    throw new CredentialVaultError("INVALID_VAULT", `Invalid ${field}`);
  }
  const decoded = Buffer.from(value, "base64");
  if (!decoded.length || (expectedLength && decoded.length !== expectedLength)) {
    throw new CredentialVaultError("INVALID_VAULT", `Invalid ${field}`);
  }
  return decoded;
};

const validateVaultRecord = (record) => {
  if (!isPlainObject(record) || record.version !== VAULT_VERSION) {
    throw new CredentialVaultError("INVALID_VAULT", "Unsupported credential vault");
  }
  if (
    !isPlainObject(record.kdf) ||
    record.kdf.name !== "scrypt" ||
    record.kdf.N !== SCRYPT_PARAMS.N ||
    record.kdf.r !== SCRYPT_PARAMS.r ||
    record.kdf.p !== SCRYPT_PARAMS.p ||
    record.kdf.keyLength !== SCRYPT_PARAMS.keyLength
  ) {
    throw new CredentialVaultError("INVALID_VAULT", "Unsupported vault KDF");
  }
  decodeBase64(record.kdf.salt, "salt", 16);
  if (!isPlainObject(record.encrypted)) {
    throw new CredentialVaultError("INVALID_VAULT", "Invalid encrypted vault");
  }
  decodeBase64(record.encrypted.iv, "IV", 12);
  decodeBase64(record.encrypted.authTag, "authentication tag", 16);
  decodeBase64(record.encrypted.ciphertext, "ciphertext");
  return record;
};

const validateCredentialName = (name) => {
  if (
    typeof name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(name)
  ) {
    throw new CredentialVaultError("INVALID_NAME", "Invalid credential name");
  }
  return name;
};

const cloneCredentialValue = (value) => {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (_) {
    throw new CredentialVaultError(
      "INVALID_VALUE",
      "Credential value must be JSON serializable"
    );
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > MAX_CREDENTIAL_SIZE
  ) {
    throw new CredentialVaultError("INVALID_VALUE", "Credential value is too large");
  }
  return JSON.parse(serialized);
};

class CredentialVault {
  constructor(options = {}) {
    if (!options.filePath) throw new Error("CredentialVault requires filePath");
    this.filePath = options.filePath;
    this.fs = options.fs || fs;
    this.crypto = options.crypto || crypto;
    this._key = null;
    this._payload = null;
  }

  get isUnlocked() {
    return Boolean(this._key && this._payload);
  }

  _deriveKey(passphrase, salt) {
    if (typeof passphrase !== "string" || !passphrase.length || passphrase.length > 4096) {
      throw new CredentialVaultError("INVALID_PASSPHRASE", "A passphrase is required");
    }
    return this.crypto.scryptSync(passphrase, salt, SCRYPT_PARAMS.keyLength, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: 64 * 1024 * 1024,
    });
  }

  _encryptPayload(payload, key, salt) {
    const iv = this.crypto.randomBytes(12);
    const cipher = this.crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(Buffer.from(VAULT_AAD, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), "utf8"),
      cipher.final(),
    ]);
    return {
      version: VAULT_VERSION,
      kdf: {
        name: "scrypt",
        salt: salt.toString("base64"),
        ...SCRYPT_PARAMS,
      },
      encrypted: {
        iv: iv.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      },
    };
  }

  _decryptPayload(record, key) {
    try {
      const decipher = this.crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        decodeBase64(record.encrypted.iv, "IV", 12)
      );
      decipher.setAAD(Buffer.from(VAULT_AAD, "utf8"));
      decipher.setAuthTag(
        decodeBase64(record.encrypted.authTag, "authentication tag", 16)
      );
      const plaintext = Buffer.concat([
        decipher.update(decodeBase64(record.encrypted.ciphertext, "ciphertext")),
        decipher.final(),
      ]).toString("utf8");
      const payload = JSON.parse(plaintext);
      if (!isPlainObject(payload) || !isPlainObject(payload.credentials)) {
        throw new Error("Invalid credential payload");
      }
      return payload;
    } catch (_) {
      throw new CredentialVaultError(
        "INVALID_PASSPHRASE",
        "Unable to unlock credential vault"
      );
    }
  }

  _readRecord() {
    let parsed;
    try {
      parsed = JSON.parse(this.fs.readFileSync(this.filePath, "utf8"));
    } catch (_) {
      throw new CredentialVaultError("INVALID_VAULT", "Unable to read credential vault");
    }
    return validateVaultRecord(parsed);
  }

  _writeRecord(record) {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${this.crypto
      .randomBytes(8)
      .toString("hex")}.tmp`;
    try {
      this.fs.writeFileSync(temporaryPath, JSON.stringify(record), {
        encoding: "utf8",
        mode: 0o600,
      });
      this.fs.renameSync(temporaryPath, this.filePath);
      try {
        this.fs.chmodSync(this.filePath, 0o600);
      } catch (_) {
        // Windows does not provide POSIX permission bits. The encrypted data
        // remains valid there, while the OS ACL controls access.
      }
    } finally {
      try {
        if (this.fs.existsSync(temporaryPath)) this.fs.unlinkSync(temporaryPath);
      } catch (_) {}
    }
  }

  _requireUnlocked() {
    if (!this.isUnlocked) {
      throw new CredentialVaultError("LOCKED", "Credential vault is locked");
    }
  }

  _persist() {
    this._requireUnlocked();
    const record = this._readRecord();
    const salt = decodeBase64(record.kdf.salt, "salt", 16);
    this._writeRecord(this._encryptPayload(this._payload, this._key, salt));
  }

  unlock(passphrase) {
    this.lock();
    if (!this.fs.existsSync(this.filePath)) {
      const salt = this.crypto.randomBytes(16);
      const key = this._deriveKey(passphrase, salt);
      this._key = key;
      this._payload = { credentials: {}, updatedAt: new Date().toISOString() };
      this._writeRecord(this._encryptPayload(this._payload, key, salt));
      return { unlocked: true, created: true };
    }

    const record = this._readRecord();
    const key = this._deriveKey(
      passphrase,
      decodeBase64(record.kdf.salt, "salt", 16)
    );
    try {
      this._payload = this._decryptPayload(record, key);
      this._key = key;
      return { unlocked: true, created: false };
    } catch (error) {
      key.fill(0);
      this._payload = null;
      throw error;
    }
  }

  lock() {
    if (this._key) this._key.fill(0);
    this._key = null;
    this._payload = null;
    return { locked: true };
  }

  get(name) {
    this._requireUnlocked();
    name = validateCredentialName(name);
    if (!Object.prototype.hasOwnProperty.call(this._payload.credentials, name)) {
      return { found: false };
    }
    return { found: true, value: cloneCredentialValue(this._payload.credentials[name]) };
  }

  set(name, value) {
    this._requireUnlocked();
    name = validateCredentialName(name);
    const clonedValue = cloneCredentialValue(value);
    if (
      !Object.prototype.hasOwnProperty.call(this._payload.credentials, name) &&
      Object.keys(this._payload.credentials).length >= MAX_CREDENTIALS
    ) {
      throw new CredentialVaultError("TOO_MANY_CREDENTIALS", "Credential limit reached");
    }
    this._payload.credentials[name] = clonedValue;
    this._payload.updatedAt = new Date().toISOString();
    this._persist();
    return { stored: true };
  }

  delete(name) {
    this._requireUnlocked();
    name = validateCredentialName(name);
    const deleted = Object.prototype.hasOwnProperty.call(
      this._payload.credentials,
      name
    );
    if (deleted) {
      delete this._payload.credentials[name];
      this._payload.updatedAt = new Date().toISOString();
      this._persist();
    }
    return { deleted };
  }

  exportEncrypted() {
    return cloneJson(this._readRecord());
  }

  importEncrypted(serializedVault) {
    let record = serializedVault;
    if (typeof record === "string") {
      try {
        record = JSON.parse(record);
      } catch (_) {
        throw new CredentialVaultError("INVALID_VAULT", "Invalid credential vault import");
      }
    }
    this.lock();
    this._writeRecord(validateVaultRecord(record));
    return { imported: true };
  }
}

module.exports = {
  CredentialVault,
  CredentialVaultError,
  VAULT_VERSION,
  SCRYPT_PARAMS,
};
