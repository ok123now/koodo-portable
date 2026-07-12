"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MIGRATED_STORE_FILE,
  getOfficialProfilePaths,
  getOfficialKoodoSources,
  sanitizeElectronStoreConfig,
  migrateOfficialSource,
} = require("../portable-migration");

const createFixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-migration-"));
  const profile = path.join(
    root,
    "Library",
    "Application Support",
    "Koodo Reader"
  );
  const library = path.join(profile, "uploads", "data");
  fs.mkdirSync(path.join(library, "book", "nested"), { recursive: true });
  fs.writeFileSync(path.join(library, "book", "nested", "book.epub"), "book-data");
  fs.writeFileSync(
    path.join(profile, "config.json"),
    JSON.stringify({
      appSkin: "night",
      encryptedToken: "official-token-must-not-copy",
      isAuthed: "yes",
      cloud: { access_token: "oauth-secret", safeValue: true },
    })
  );
  const portableData = path.join(root, "Koodo Portable Data");
  const targetLibrary = path.join(portableData, "Library");
  const targetProfile = path.join(portableData, "Profile");
  fs.mkdirSync(targetLibrary, { recursive: true });
  fs.mkdirSync(targetProfile, { recursive: true });
  return { root, profile, library, targetLibrary, targetProfile };
};

test("macOS and Windows profile detection uses official Electron locations", () => {
  assert.deepEqual(
    getOfficialProfilePaths({ platform: "darwin", homeDir: "/Users/test" }),
    [
      "/Users/test/Library/Application Support/Koodo Reader",
      "/Users/test/Library/Application Support/koodo-reader",
    ]
  );
  assert.deepEqual(
    getOfficialProfilePaths({
      platform: "win32",
      homeDir: "C:\\Users\\test",
      env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
    }),
    [
      "C:\\Users\\test\\AppData\\Roaming/Koodo Reader",
      "C:\\Users\\test\\AppData\\Roaming/koodo-reader",
    ]
  );
});

test("status discovers a standard official library without exposing credentials", () => {
  const fixture = createFixture();
  try {
    const sources = getOfficialKoodoSources({
      platform: "darwin",
      homeDir: fixture.root,
    });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].libraryPath, fixture.library);
    assert.deepEqual(sources[0].profileConfig, {
      found: true,
      parseable: true,
      removedKeyCount: 3,
    });
    assert.equal(JSON.stringify(sources).includes("official-token-must-not-copy"), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("dry-run is read-only and migration copies into an empty Portable Library", () => {
  const fixture = createFixture();
  try {
    const [source] = getOfficialKoodoSources({
      platform: "darwin",
      homeDir: fixture.root,
    });
    const sourceConfig = fs.readFileSync(path.join(fixture.profile, "config.json"), "utf8");
    const dryRun = migrateOfficialSource({
      source,
      targetLibrary: fixture.targetLibrary,
      targetProfile: fixture.targetProfile,
      dryRun: true,
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(fs.readdirSync(fixture.targetLibrary).length, 0);
    assert.equal(fs.readFileSync(path.join(fixture.profile, "config.json"), "utf8"), sourceConfig);

    const result = migrateOfficialSource({
      source,
      targetLibrary: fixture.targetLibrary,
      targetProfile: fixture.targetProfile,
    });
    assert.equal(result.migrated, true);
    assert.equal(
      fs.readFileSync(path.join(fixture.targetLibrary, "book", "nested", "book.epub"), "utf8"),
      "book-data"
    );
    assert.equal(fs.readFileSync(path.join(fixture.profile, "config.json"), "utf8"), sourceConfig);

    const sanitized = JSON.parse(
      fs.readFileSync(path.join(fixture.targetProfile, MIGRATED_STORE_FILE), "utf8")
    );
    assert.equal(sanitized.appSkin, "night");
    assert.equal("encryptedToken" in sanitized, false);
    assert.equal("isAuthed" in sanitized, false);
    assert.equal("access_token" in sanitized.cloud, false);
    assert.equal(sanitized.cloud.safeValue, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("migration refuses to overwrite an existing Portable Library", () => {
  const fixture = createFixture();
  try {
    const [source] = getOfficialKoodoSources({
      platform: "darwin",
      homeDir: fixture.root,
    });
    fs.writeFileSync(path.join(fixture.targetLibrary, "already-here"), "keep");
    assert.throws(
      () =>
        migrateOfficialSource({
          source,
          targetLibrary: fixture.targetLibrary,
          targetProfile: fixture.targetProfile,
        }),
      /will not be overwritten/
    );
    assert.equal(fs.readFileSync(path.join(fixture.targetLibrary, "already-here"), "utf8"), "keep");
    assert.equal(fs.existsSync(path.join(fixture.targetLibrary, "book")), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("sanitization removes account and OAuth fields without removing normal settings", () => {
  const sanitized = sanitizeElectronStoreConfig({
    appSkin: "night",
    nested: { refreshToken: "secret", windowWidth: 1200 },
    oauthProvider: "Koodo",
  });
  assert.deepEqual(sanitized.config, {
    appSkin: "night",
    nested: { windowWidth: 1200 },
  });
  assert.deepEqual(sanitized.removedKeys, ["nested.refreshToken", "oauthProvider"]);
});
