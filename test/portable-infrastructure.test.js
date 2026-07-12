"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEVELOPMENT_DATA_DIRECTORY,
  PACKAGED_DATA_DIRECTORY,
  ensurePortablePaths,
  resolvePortablePaths,
} = require("../portable-paths");
const { CredentialVault, CredentialVaultError } = require("../credential-vault");
const { shouldBlockOfficialRequest } = require("../network-policy");
const { isTrustedLocalRendererUrl } = require("../ipc-security");

test("portable paths are sibling to a packaged application and keep runtime separate", () => {
  const paths = resolvePortablePaths({
    isPackaged: true,
    platform: "darwin",
    execPath: "/Applications/Koodo Reader.app/Contents/MacOS/Koodo Reader",
  });
  assert.equal(paths.data, path.join("/Applications", PACKAGED_DATA_DIRECTORY));
  assert.equal(paths.profile, path.join(paths.data, "Profile"));
  assert.equal(paths.library, path.join(paths.data, "Library"));
  assert.equal(paths.runtime, path.join(paths.data, "Runtime"));
  assert.equal(paths.logs, path.join(paths.data, "Logs"));
  assert.equal(paths.session, path.join(paths.profile, "Session"));
});

test("development paths use a hidden data directory and are created", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-paths-"));
  try {
    const paths = ensurePortablePaths(
      resolvePortablePaths({ appPath: root, isPackaged: false })
    );
    assert.equal(paths.data, path.join(root, DEVELOPMENT_DATA_DIRECTORY));
    [paths.profile, paths.library, paths.runtime, paths.logs, paths.ocr, paths.tts].forEach(
      (directory) => assert.equal(fs.statSync(directory).isDirectory(), true)
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("credential vault encrypts at rest, survives export/import, and locks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-vault-"));
  try {
    const vaultPath = path.join(root, "credentials.vault.json");
    const vault = new CredentialVault({ filePath: vaultPath });
    assert.deepEqual(vault.unlock("test passphrase"), { unlocked: true, created: true });
    vault.set("ai.primary", { apiKey: "top-secret", model: "example" });
    assert.deepEqual(vault.get("ai.primary"), {
      found: true,
      value: { apiKey: "top-secret", model: "example" },
    });
    assert.equal(fs.readFileSync(vaultPath, "utf8").includes("top-secret"), false);

    const exported = vault.exportEncrypted();
    vault.lock();
    assert.throws(() => vault.get("ai.primary"), CredentialVaultError);

    const imported = new CredentialVault({ filePath: path.join(root, "imported.json") });
    imported.importEncrypted(exported);
    assert.deepEqual(imported.unlock("test passphrase"), {
      unlocked: true,
      created: false,
    });
    assert.deepEqual(imported.get("ai.primary"), {
      found: true,
      value: { apiKey: "top-secret", model: "example" },
    });
    imported.lock();
    assert.throws(() => imported.unlock("incorrect"), CredentialVaultError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("official Koodo domains are blocked while local development is allowed", () => {
  assert.equal(shouldBlockOfficialRequest("https://api.koodoreader.com/api/v1"), true);
  assert.equal(shouldBlockOfficialRequest("https://cloud.koodoreader.cn/data"), true);
  assert.equal(shouldBlockOfficialRequest("https://cloudtest.960960.xyz/data"), true);
  assert.equal(shouldBlockOfficialRequest("http://localhost:3000"), false);
  assert.equal(shouldBlockOfficialRequest("http://127.0.0.1:3000"), false);
  assert.equal(shouldBlockOfficialRequest("file:///tmp/index.html"), false);
  assert.equal(shouldBlockOfficialRequest("https://koodoreader.com.example.test"), false);
});

test("only local packaged or local development renderers can access privileged IPC", () => {
  assert.equal(isTrustedLocalRendererUrl("file:///Applications/Koodo/index.html"), true);
  assert.equal(
    isTrustedLocalRendererUrl("http://localhost:3000", { isDev: true }),
    true
  );
  assert.equal(
    isTrustedLocalRendererUrl("http://localhost:3000", { isDev: false }),
    false
  );
  assert.equal(
    isTrustedLocalRendererUrl("https://koodoreader.com", { isDev: true }),
    false
  );
});
