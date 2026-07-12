"use strict";

const fs = require("fs");
const path = require("path");

const PORTABLE_ROOT_ENV = "KOODO_PORTABLE_ROOT";
const PACKAGED_DATA_DIRECTORY = "Koodo Portable Data";
const DEVELOPMENT_DATA_DIRECTORY = ".portable-data";

/**
 * Find the directory containing a macOS .app bundle.  The application bundle
 * itself is deliberately not used as a writable location: macOS can mount it
 * read-only or translocate it when it was launched from a downloaded image.
 */
const findMacBundleParent = (execPath) => {
  let current = path.resolve(execPath);
  while (true) {
    const parent = path.dirname(current);
    if (parent.toLowerCase().endsWith(".app")) {
      return path.dirname(parent);
    }
    if (parent === current) return null;
    current = parent;
  }
};

const resolvePortableRoot = (options = {}) => {
  const {
    env = process.env,
    portableRoot,
    isPackaged = false,
    platform = process.platform,
    execPath = process.execPath,
    appPath,
    cwd = process.cwd(),
  } = options;

  const configuredRoot = portableRoot || env[PORTABLE_ROOT_ENV];
  if (configuredRoot) return path.resolve(configuredRoot);

  if (isPackaged && platform === "darwin") {
    const bundleParent = findMacBundleParent(execPath);
    if (bundleParent) return bundleParent;
  }

  if (isPackaged) return path.dirname(path.resolve(execPath));

  // In development, keep generated data in the checked-out application root
  // unless the explicit environment override above is supplied.
  return path.resolve(appPath || cwd);
};

const resolvePortablePaths = (options = {}) => {
  const root = resolvePortableRoot(options);
  const data = path.join(
    root,
    options.isPackaged ? PACKAGED_DATA_DIRECTORY : DEVELOPMENT_DATA_DIRECTORY
  );
  const profile = path.join(data, "Profile");
  const runtime = path.join(data, "Runtime");

  return Object.freeze({
    root,
    data,
    profile,
    session: path.join(profile, "Session"),
    library: path.join(data, "Library"),
    runtime,
    logs: path.join(data, "Logs"),
    ocr: path.join(runtime, "ocr"),
    tts: path.join(runtime, "tts"),
    credentialVault: path.join(profile, "credentials.vault.json"),
  });
};

const ensurePortablePaths = (paths, fsImpl = fs) => {
  [
    paths.data,
    paths.profile,
    paths.session,
    paths.library,
    paths.runtime,
    paths.logs,
    paths.ocr,
    paths.tts,
  ].forEach((directory) => fsImpl.mkdirSync(directory, { recursive: true }));
  return paths;
};

module.exports = {
  PORTABLE_ROOT_ENV,
  PACKAGED_DATA_DIRECTORY,
  DEVELOPMENT_DATA_DIRECTORY,
  findMacBundleParent,
  resolvePortableRoot,
  resolvePortablePaths,
  ensurePortablePaths,
};
