import React from "react";
import { SettingInfoProps, SettingInfoState } from "./interface";
import { Trans } from "react-i18next";
import packageJson from "../../../../package.json";
import { isElectron } from "react-device-detect";
import { openExternalUrl } from "../../../utils/common";
declare var window: any;

class AboutSetting extends React.Component<SettingInfoProps, SettingInfoState> {
  constructor(props: SettingInfoProps) {
    super(props);
    this.state = {};
  }

  render() {
    return (
      <>
        <div className="setting-dialog-new-title">
          <Trans>Current version</Trans>
          <div style={{ display: "flex", alignItems: "center" }}>
            <span>{packageJson.version}</span>

          </div>
        </div>
        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Get debug logs</Trans>
            <span
              className="change-location-button"
              onClick={async () => {
                const { ipcRenderer } = window.require("electron");
                ipcRenderer.invoke("get-debug-logs", "ping");
              }}
            >
              <Trans>Locate</Trans>
            </span>
          </div>
        )}
        <div className="setting-dialog-new-title">
          <span>Koodo Portable · AGPL-3.0-or-later</span>
          <span
            className="change-location-button"
            onClick={() =>
              openExternalUrl("https://github.com/ok123now/koodo-portable")
            }
          >
            <Trans>Source code</Trans>
          </span>
        </div>

        {isElectron && (
          <div className="setting-dialog-new-title">
            <Trans>Open console</Trans>
            <span
              className="change-location-button"
              onClick={async () => {
                window
                  .require("electron")
                  .ipcRenderer.invoke("open-console", "ping");
              }}
            >
              <Trans>View</Trans>
            </span>
          </div>
        )}
        {/* Official Koodo documentation, support, and download links are not
            part of this independent portable build. */}
        {/*
        <div className="setting-dialog-new-title">
          <Trans>Document</Trans>

          <span
            className="change-location-button"
            onClick={async () => {
              if (
                ConfigService.getReaderConfig("lang") &&
                ConfigService.getReaderConfig("lang").startsWith("zh")
              ) {
                openExternalUrl(getWebsiteUrl() + "/zh/document");
              } else {
                openExternalUrl(getWebsiteUrl() + "/en/document");
              }
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Support</Trans>

          <span
            className="change-location-button"
            onClick={async () => {
              if (
                ConfigService.getReaderConfig("lang") &&
                ConfigService.getReaderConfig("lang").startsWith("zh")
              ) {
                openExternalUrl(getWebsiteUrl() + "/zh/support");
              } else {
                openExternalUrl(getWebsiteUrl() + "/en/support");
              }
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Shortcuts</Trans>

          <span
            className="change-location-button"
            onClick={async () => {
              if (
                ConfigService.getReaderConfig("lang") &&
                ConfigService.getReaderConfig("lang").startsWith("zh")
              ) {
                openExternalUrl(getWebsiteUrl() + "/zh/use-shortcut");
              } else {
                openExternalUrl(getWebsiteUrl() + "/en/use-shortcut");
              }
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Our website</Trans>

          <span
            className="change-location-button"
            onClick={() => {
              openExternalUrl(getWebsiteUrl());
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Send email</Trans>

          <span
            className="change-location-button"
            onClick={() => {
              copyTextToClipboard("feedback@koodoreader.com");
              toast.success(this.props.t("Email copied to clipboard"));
            }}
          >
            <Trans>Copy</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>Translation</Trans>

          <span
            className="change-location-button"
            onClick={() => {
              openExternalUrl(
                "https://github.com/koodo-reader/koodo-reader#translation"
              );
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        <div className="setting-dialog-new-title">
          <Trans>GitHub repository</Trans>

          <span
            className="change-location-button"
            onClick={() => {
              openExternalUrl("https://github.com/koodo-reader/koodo-reader");
            }}
          >
            <Trans>Visit</Trans>
          </span>
        </div>
        */}
      </>
    );
  }
}

export default AboutSetting;
