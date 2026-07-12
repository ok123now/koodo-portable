"use strict";

const OFFICIAL_HOST_SUFFIXES = Object.freeze([
  "koodoreader.com",
  "koodoreader.cn",
  "960960.xyz",
]);

const isLocalHostname = (hostname) => {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
};

const isOfficialHostname = (hostname) => {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!normalized || isLocalHostname(normalized)) return false;
  return OFFICIAL_HOST_SUFFIXES.some(
    (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
  );
};

const shouldBlockOfficialRequest = (url) => {
  try {
    const parsed = new URL(url);
    // file:// and any local development web server remain untouched. Network
    // filtering is purposefully restricted to HTTP(S) official endpoints.
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isOfficialHostname(parsed.hostname);
  } catch (_) {
    return false;
  }
};

const installOfficialNetworkBlocker = (electronSession, logger = console) => {
  if (!electronSession || !electronSession.webRequest) {
    throw new Error("An Electron session with webRequest is required");
  }
  electronSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) => {
    const cancel = shouldBlockOfficialRequest(details.url);
    if (cancel && logger && typeof logger.warn === "function") {
      logger.warn(`Blocked Koodo official request: ${details.url}`);
    }
    callback({ cancel });
  });
};

module.exports = {
  OFFICIAL_HOST_SUFFIXES,
  isLocalHostname,
  isOfficialHostname,
  shouldBlockOfficialRequest,
  installOfficialNetworkBlocker,
};
