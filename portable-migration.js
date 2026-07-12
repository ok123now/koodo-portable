"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const MAX_ELECTRON_STORE_BYTES = 1024 * 1024;
const MIGRATED_STORE_FILE = "migrated-official-store.json";
const OFFICIAL_APP_NAMES = Object.freeze(["Koodo Reader", "koodo-reader"]);

const isPlainObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isDirectory = (location, fsImpl = fs) => {
  try {
    return fsImpl.statSync(location).isDirectory();
  } catch (_) {
    return false;
  }
};

const isFile = (location, fsImpl = fs) => {
  try {
    return fsImpl.statSync(location).isFile();
  } catch (_) {
    return false;
  }
};

const normalizePath = (location) => path.resolve(location);

const isPathWithin = (candidate, parent) => {
  const relative = path.relative(normalizePath(parent), normalizePath(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

const getOfficialProfilePaths = (options = {}) => {
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();
  const env = options.env || process.env;
  let parent;
  if (platform === "darwin") {
    parent = path.join(homeDir, "Library", "Application Support");
  } else if (platform === "win32") {
    parent = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
  } else {
    return [];
  }
  return OFFICIAL_APP_NAMES.map((appName) => path.join(parent, appName));
};

const readElectronStoreConfig = (profilePath, fsImpl = fs) => {
  const filePath = path.join(profilePath, "config.json");
  if (!isFile(filePath, fsImpl)) return { found: false, parseable: false };
  try {
    if (fsImpl.statSync(filePath).size > MAX_ELECTRON_STORE_BYTES) {
      return { found: true, parseable: false, reason: "too_large" };
    }
    const value = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
    if (!isPlainObject(value)) {
      return { found: true, parseable: false, reason: "not_object" };
    }
    return { found: true, parseable: true, value };
  } catch (_) {
    return { found: true, parseable: false, reason: "invalid_json" };
  }
};

const normalizedKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
const isSensitiveElectronStoreKey = (key) => {
  const normalized = normalizedKey(key);
  return (
    [
      "encryptedtoken",
      "token",
      "accesstoken",
      "refreshtoken",
      "idtoken",
      "authtoken",
      "isauthed",
      "userinfo",
      "userid",
      "userprofile",
      "account",
      "accountid",
      "member",
      "memberinfo",
      "validuntil",
      "credential",
      "credentials",
    ].includes(normalized) ||
    normalized.endsWith("token") ||
    normalized.includes("oauth")
  );
};

const sanitizeElectronStoreConfig = (config) => {
  if (!isPlainObject(config)) return { config: {}, removedKeys: [] };
  const removedKeys = [];
  const sanitize = (value, keyPath = []) => {
    if (Array.isArray(value)) {
      return value.map((item, index) => sanitize(item, keyPath.concat(index)));
    }
    if (!isPlainObject(value)) return value;
    const cleaned = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveElectronStoreKey(key)) {
        removedKeys.push(keyPath.concat(key).join("."));
        continue;
      }
      cleaned[key] = sanitize(item, keyPath.concat(key));
    }
    return cleaned;
  };
  return { config: sanitize(config), removedKeys };
};

const findStorageLocations = (config) => {
  const locations = [];
  const visit = (value, depth = 0) => {
    if (depth > 4 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, item] of Object.entries(value)) {
      if (normalizedKey(key) === "storagelocation" && typeof item === "string") {
        locations.push(item);
      } else {
        visit(item, depth + 1);
      }
    }
  };
  visit(config);
  return [...new Set(locations.filter((item) => path.isAbsolute(item)).map(normalizePath))];
};

const getOfficialKoodoSources = (options = {}) => {
  const fsImpl = options.fs || fs;
  const result = [];
  const seenLibraries = new Set();
  const profilePaths = getOfficialProfilePaths(options);
  profilePaths.forEach((profilePath, profileIndex) => {
    if (!isDirectory(profilePath, fsImpl)) return;
    const store = readElectronStoreConfig(profilePath, fsImpl);
    const storageLocations = store.parseable ? findStorageLocations(store.value) : [];
    const libraryCandidates = [
      ...storageLocations.map((libraryPath) => ({ libraryPath, kind: "configured" })),
      { libraryPath: path.join(profilePath, "uploads", "data"), kind: "default" },
      { libraryPath: path.join(profilePath, "data"), kind: "legacy" },
    ];
    const sanitized = store.parseable
      ? sanitizeElectronStoreConfig(store.value)
      : { removedKeys: [] };
    libraryCandidates.forEach(({ libraryPath, kind }, libraryIndex) => {
      const resolvedLibrary = normalizePath(libraryPath);
      if (!isDirectory(resolvedLibrary, fsImpl) || seenLibraries.has(resolvedLibrary)) return;
      seenLibraries.add(resolvedLibrary);
      result.push({
        id: `official-${profileIndex}-${libraryIndex}`,
        profilePath: normalizePath(profilePath),
        libraryPath: resolvedLibrary,
        kind,
        profileConfig: {
          found: store.found,
          parseable: store.parseable,
          removedKeyCount: sanitized.removedKeys.length,
        },
      });
    });
  });
  return result;
};

const isDirectoryEmpty = (location, fsImpl = fs) =>
  isDirectory(location, fsImpl) && fsImpl.readdirSync(location).length === 0;

const scanDirectoryReadOnly = (location, fsImpl = fs) => {
  const root = normalizePath(location);
  if (!isDirectory(root, fsImpl)) throw new Error("Migration source library is not a directory");
  const rootStat = fsImpl.lstatSync(root);
  if (rootStat.isSymbolicLink()) throw new Error("Migration source library cannot be a symlink");
  let fileCount = 0;
  let directoryCount = 0;
  let totalBytes = 0;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fsImpl.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      const stat = fsImpl.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        throw new Error("Migration source contains a symlink");
      }
      if (stat.isDirectory()) {
        directoryCount += 1;
        stack.push(entryPath);
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
      }
    }
  }
  return { fileCount, directoryCount, totalBytes };
};

const validateMigrationPaths = ({ sourceLibrary, targetLibrary }, fsImpl = fs) => {
  const source = normalizePath(sourceLibrary);
  const target = normalizePath(targetLibrary);
  if (!isDirectory(source, fsImpl)) throw new Error("Migration source library is not available");
  if (!isDirectory(target, fsImpl)) throw new Error("Portable Library is not available");
  const canonicalSource = fsImpl.realpathSync(source);
  const canonicalTarget = fsImpl.realpathSync(target);
  if (isPathWithin(canonicalSource, canonicalTarget)) {
    throw new Error("Migration source cannot equal or be inside Portable Library");
  }
  if (isPathWithin(canonicalTarget, canonicalSource)) {
    throw new Error("Portable Library cannot be inside the migration source");
  }
  if (!isDirectoryEmpty(canonicalTarget, fsImpl)) {
    throw new Error("Portable Library already contains data and will not be overwritten");
  }
  return { sourceLibrary: canonicalSource, targetLibrary: canonicalTarget };
};

const buildMigrationPlan = ({ source, targetLibrary, targetProfile, fs: fsImpl = fs }) => {
  const paths = validateMigrationPaths(
    { sourceLibrary: source.libraryPath, targetLibrary },
    fsImpl
  );
  const scan = scanDirectoryReadOnly(paths.sourceLibrary, fsImpl);
  const store = readElectronStoreConfig(source.profilePath, fsImpl);
  const sanitized = store.parseable
    ? sanitizeElectronStoreConfig(store.value)
    : { config: null, removedKeys: [] };
  const profileConfigPath = path.join(targetProfile, MIGRATED_STORE_FILE);
  return {
    source: {
      id: source.id,
      profilePath: source.profilePath,
      libraryPath: paths.sourceLibrary,
    },
    targetLibrary: paths.targetLibrary,
    copy: scan,
    profileConfig: {
      sourceFound: store.found,
      sourceParseable: store.parseable,
      removedKeyCount: sanitized.removedKeys.length,
      targetPath: profileConfigPath,
      willCopy: Boolean(store.parseable && !isFile(profileConfigPath, fsImpl)),
    },
    _sanitizedConfig: sanitized.config,
  };
};

const writeJsonAtomically = (filePath, value, fsImpl = fs) => {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fsImpl.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  fsImpl.renameSync(temporaryPath, filePath);
};

const migrateOfficialSource = ({ source, targetLibrary, targetProfile, dryRun = false, fs: fsImpl = fs }) => {
  const plan = buildMigrationPlan({ source, targetLibrary, targetProfile, fs: fsImpl });
  const result = { ...plan };
  delete result._sanitizedConfig;
  result.dryRun = Boolean(dryRun);
  if (dryRun) return result;

  const stagingPath = path.join(
    path.dirname(plan.targetLibrary),
    `.library-migration-${process.pid}-${Date.now()}`
  );
  try {
    // cpSync only reads from source; the source is never renamed, deleted, or
    // otherwise changed. Staging ensures an interrupted copy cannot merge
    // into an existing Portable Library.
    fsImpl.cpSync(plan.source.libraryPath, stagingPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      dereference: false,
      preserveTimestamps: true,
    });
    if (!isDirectoryEmpty(plan.targetLibrary, fsImpl)) {
      throw new Error("Portable Library changed during migration; refusing to overwrite it");
    }
    fsImpl.rmdirSync(plan.targetLibrary);
    fsImpl.renameSync(stagingPath, plan.targetLibrary);

    if (plan.profileConfig.willCopy && plan._sanitizedConfig) {
      fsImpl.mkdirSync(targetProfile, { recursive: true, mode: 0o700 });
      if (!fsImpl.existsSync(plan.profileConfig.targetPath)) {
        writeJsonAtomically(plan.profileConfig.targetPath, plan._sanitizedConfig, fsImpl);
        result.profileConfig.copied = true;
      }
    }
    result.migrated = true;
    return result;
  } finally {
    try {
      if (fsImpl.existsSync(stagingPath)) {
        fsImpl.rmSync(stagingPath, { recursive: true, force: true });
      }
    } catch (_) {}
  }
};

module.exports = {
  MIGRATED_STORE_FILE,
  getOfficialProfilePaths,
  readElectronStoreConfig,
  sanitizeElectronStoreConfig,
  getOfficialKoodoSources,
  isPathWithin,
  validateMigrationPaths,
  buildMigrationPlan,
  migrateOfficialSource,
};
