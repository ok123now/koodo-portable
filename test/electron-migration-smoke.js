"use strict";

// Manual integration smoke test. It only prints migrated key names and model
// counts; credential values are never printed.
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const profile = process.env.KOODO_MIGRATION_PROFILE;
if (!profile) throw new Error("KOODO_MIGRATION_PROFILE is required");
const tempProfile = fs.mkdtempSync(path.join(os.tmpdir(), "koodo-electron-migration-"));
app.setPath("userData", tempProfile);

app.whenReady().then(async () => {
  const partitionName = "persist:migration-smoke";
  const partitionPath = path.join(tempProfile, "Partitions", "migration-smoke");
  const target = path.join(partitionPath, "Local Storage");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(profile, "Local Storage"), target, { recursive: true });
  fs.rmSync(path.join(target, "leveldb", "LOCK"), { force: true });
  const migrationSession = session.fromPartition(partitionName, { cache: false });
  process.stderr.write(`partition=${migrationSession.getStoragePath()} copied=${target}\n`);
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: partitionName, sandbox: true },
  });
  try {
    const officialPage = process.env.KOODO_MIGRATION_PAGE;
    if (officialPage) {
      await win.loadFile(officialPage);
    } else {
      await win.loadFile(path.join(__dirname, "..", "migration-reader.html"));
    }
    const summary = await win.webContents.executeJavaScript(`(() => {
      const keys = ["readerConfig", "aiModelConfig", "recordLocation", "readingTime"];
      const present = keys.filter((key) => localStorage.getItem(key) !== null);
      let modelCount = 0;
      try { modelCount = Object.keys(JSON.parse(localStorage.getItem("aiModelConfig") || "{}")).length; } catch (_) {}
      return { present, modelCount };
    })()`);
    process.stdout.write(JSON.stringify(summary) + "\n");
  } finally {
    win.destroy();
    app.quit();
  }
});

app.on("quit", () => {
  fs.rmSync(tempProfile, { recursive: true, force: true });
});
