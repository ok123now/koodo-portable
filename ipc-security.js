"use strict";

const { isLocalHostname } = require("./network-policy");

/**
 * Only the packaged file:// UI, or the explicit local React development
 * server, may use privileged portable-storage IPC handlers. Remote pages must
 * never be able to ask the main process to reveal a credential value.
 */
const isTrustedLocalRendererUrl = (url, { isDev = false } = {}) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return true;
    return (
      isDev &&
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      isLocalHostname(parsed.hostname)
    );
  } catch (_) {
    return false;
  }
};

module.exports = { isTrustedLocalRendererUrl };
