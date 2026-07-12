import React from "react";
import "./header.css";
import SearchBox from "../../components/searchBox";
import ImportLocal from "../../components/importLocal";
import { HeaderProps, HeaderState } from "./interface";
import {
  ConfigService,
  TokenService,
  KOReaderUtil,
} from "../../assets/lib/kookit-extra-browser.min";
import { generateSnapshot } from "../../utils/file/backup";
import { isElectron } from "react-device-detect";
import {
  getCloudConfig,
  upgradeConfig,
  upgradeStorage,
} from "../../utils/file/common";
import toast from "react-hot-toast";
import { Trans } from "react-i18next";
import { SyncHelper } from "../../assets/lib/kookit-extra-browser.min";
import ConfigUtil from "../../utils/file/configUtil";
import DatabaseService from "../../utils/storage/databaseService";
import CoverUtil from "../../utils/file/coverUtil";
import BookUtil from "../../utils/file/bookUtil";
import {
  checkBrokenDatabase,
  checkMissingBook,
  getBookPartialMd5,
  getTaskStats,
  showTaskProgress,
  throttle,
} from "../../utils/common";
import { driveList } from "../../constants/driveList";
import { LocalFileManager } from "../../utils/file/localFile";
declare var window: any;

class Header extends React.Component<HeaderProps, HeaderState> {
  timer: any;
  scheduledSyncTimer: any;
  private isSyncing: boolean = false;
  private resizeHandler: (() => void) | null = null;
  constructor(props: HeaderProps) {
    super(props);

    this.state = {
      isOnlyLocal: false,
      language: ConfigService.getReaderConfig("lang"),
      isNewVersion: false,
      width: document.body.clientWidth,
      isSync: false,
    };
  }
  async componentDidMount() {
    // This fork uses the ordinary file-based sync protocol only. Never carry
    // a migrated Koodo Sync flag into calls to the hosted sync service.
    if (ConfigService.getReaderConfig("isEnableKoodoSync") === "yes") {
      ConfigService.setReaderConfig("isEnableKoodoSync", "no");
    }
    if (isElectron) {
      try {
        await generateSnapshot();
      } catch (error) {
        console.error("Failed to generate snapshot:", error);
      }
    }
    this.props.handleFetchDefaultSyncOption();
    this.props.handleFetchDataSourceList();
    if (isElectron) {
      const fs = window.require("fs");
      const path = window.require("path");
      const { ipcRenderer } = window.require("electron");
      const dirPath = ipcRenderer.sendSync("user-data", "ping");
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(path.join(dirPath, "data", "book"), { recursive: true });
      }

      if (
        ConfigService.getReaderConfig("storageLocation") &&
        !ConfigService.getItem("storageLocation")
      ) {
        ConfigService.setItem(
          "storageLocation",
          ConfigService.getReaderConfig("storageLocation")
        );
      }
      //Check for data update
      //upgrade data from old version
      let res1 = await upgradeStorage(this.handleFinishUpgrade);
      let res2 = upgradeConfig();
      if (!res1 || !res2) {
        console.error("upgrade failed");
      }

      ipcRenderer.on("reading-finished", async (event: any, config: any) => {
        this.handleFinishReading();
      });
      ipcRenderer.on(
        "open-book-from-link",
        async (_event: any, config: any) => {
          const book = await DatabaseService.getRecord(config.bookKey, "books");
          if (book) {
            BookUtil.redirectBook(book);
          }
        }
      );
      ipcRenderer.on(
        "open-note-from-link",
        async (_event: any, config: any) => {
          const note = await DatabaseService.getRecord(config.noteKey, "notes");
          if (!note) return;
          const book = await DatabaseService.getRecord(note.bookKey, "books");
          if (!book) return;
          let bookLocation: any = {};
          try {
            bookLocation = JSON.parse(note.cfi) || {};
          } catch (error) {
            bookLocation.cfi = note.cfi;
            bookLocation.chapterTitle = note.chapter;
          }
          if (bookLocation.fingerprint) {
            bookLocation.chapterDocIndex = bookLocation.page - 1 + "";
            bookLocation.chapterHref = "title" + (bookLocation.page - 1);
          }
          ConfigService.setObjectConfig(
            note.bookKey,
            bookLocation,
            "recordLocation"
          );
          BookUtil.redirectBook(book);
        }
      );
    } else {
      upgradeConfig();
      const status = await LocalFileManager.getPermissionStatus();
      if (
        !ConfigService.getItem("isUseLocal") &&
        LocalFileManager.isSupported()
      ) {
        this.props.handleLocalFileDialog(true);
      } else if (
        ConfigService.getItem("isUseLocal") === "yes" &&
        !status.directoryName
      ) {
        this.props.handleLocalFileDialog(true);
      } else if (
        ConfigService.getItem("isUseLocal") === "yes" &&
        (status.needsReauthorization || !status.hasAccess)
      ) {
        this.props.handleLocalFileDialog(true);
      }
    }
    this.resizeHandler = throttle(() => {
      this.setState({ width: document.body.clientWidth });
    });
    window.addEventListener("resize", this.resizeHandler);
    this.props.handleCloudSyncFunc(this.handleCloudSync);
    document.addEventListener("visibilitychange", async (event) => {
      if (
        document.visibilityState === "visible" &&
        !isElectron &&
        ConfigService.getReaderConfig("isFinishWebReading") === "yes"
      ) {
        await this.handleFinishReading();
        // ConfigService.setReaderConfig("isFinishWebReading", "no");
      }
    });
    let willAutoSync =
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      ConfigService.getItem("defaultSyncOption");
    if (willAutoSync) {
      this.setState({ isSync: true }, async () => {
        await this.handleCloudSync();
        await this.handleOpenLastReadBook();
      });
    } else {
      this.handleOpenLastReadBook();
    }
    this.startScheduledSync();
  }
  componentWillUnmount() {
    if (this.scheduledSyncTimer) {
      clearInterval(this.scheduledSyncTimer);
      this.scheduledSyncTimer = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
  }
  startScheduledSync = () => {
    if (this.scheduledSyncTimer) {
      clearInterval(this.scheduledSyncTimer);
      this.scheduledSyncTimer = null;
    }
    const intervalMinutes = parseInt(
      ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
    );
    if (!intervalMinutes || intervalMinutes <= 0) {
      return;
    }
    const intervalMs = intervalMinutes * 60 * 1000;
    this.scheduledSyncTimer = setInterval(async () => {
      const currentInterval = parseInt(
        ConfigService.getReaderConfig("scheduledSyncInterval") || "0"
      );
      if (!currentInterval || currentInterval <= 0) {
        clearInterval(this.scheduledSyncTimer);
        this.scheduledSyncTimer = null;
        return;
      }
      const defaultSyncOption = ConfigService.getItem("defaultSyncOption");
      if (
        !defaultSyncOption ||
        ConfigService.getReaderConfig("isDisableAutoSync") === "yes"
      ) {
        return;
      }
      if (!this.state.isSync && !this.isSyncing) {
        await this.handleCloudSync();
      }
    }, intervalMs);
  };
  handleOpenLastReadBook = async () => {
    let filePath = "";
    //open book when app start
    if (isElectron) {
      const { ipcRenderer } = window.require("electron");
      filePath = ipcRenderer.sendSync("check-file-data");
    }
    if (
      ConfigService.getReaderConfig("isOpenBook") === "yes" &&
      !this.props.currentBook.key &&
      !filePath
    ) {
      let lastReadBookKey = ConfigService.getAllListConfig("recentBooks")[0];
      if (lastReadBookKey) {
        let fullBook = await DatabaseService.getRecord(
          lastReadBookKey,
          "books"
        );
        if (fullBook) {
          this.props.handleReadingBook(fullBook);
          BookUtil.redirectBook(fullBook);
        }
      }
    }
  };
  handleFinishReading = async () => {
    if (
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      ConfigService.getItem("defaultSyncOption") &&
      !this.state.isSync
    ) {
      ConfigService.setItem("isFinshReading", "yes");
      this.setState({ isSync: true }, async () => {
        await this.handleCloudSync();
        ConfigService.setItem("isFinshReading", "no");
      });
    }
  };
  handleFinishUpgrade = () => {
    setTimeout(() => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
      }
    }, 2000);
  };

  handleKOReaderSync = async () => {
    if (ConfigService.getReaderConfig("isEnableKoReaderSync") !== "yes") {
      return;
    }

    toast.loading(this.props.t("Start syncing") + " (KOReader)", {
      id: "koreader-sync",
      position: "bottom-center",
    });
    try {
      const koReaderUtil = new KOReaderUtil(
        ConfigService,
        TokenService,
        DatabaseService
      );
      const summary =
        await koReaderUtil.syncKOReaderProgress(getBookPartialMd5);
      if (summary.pulledBooks > 0 || summary.pushedBooks > 0) {
        this.props.handleFetchBooks();
      }
      toast.success(
        this.props.t("Synchronisation successful") + " (KOReader)",
        {
          id: "koreader-sync",
        }
      );
    } catch (error) {
      console.error(error);
      toast.error(
        this.props.t("Sync failed") +
          " (KOReader): " +
          (error instanceof Error ? error.message : String(error)),
        {
          id: "koreader-sync",
          duration: 6000,
        }
      );
    }
  };
  beforeSync = async () => {
    if (!ConfigService.getItem("defaultSyncOption")) {
      toast.error(
        this.props.t(
          "Please add data source in the setting-Sync and backup first"
        )
      );
      this.props.handleSetting(true);
      this.props.handleSettingMode("sync");
      return false;
    }
    let config = await getCloudConfig(
      ConfigService.getItem("defaultSyncOption") || ""
    );
    if (Object.keys(config).length === 0) {
      toast.error(this.props.t("Cannot get sync config"));
      return false;
    }
    await checkMissingBook();
    let checkResult = await checkBrokenDatabase();
    if (checkResult) {
      toast.error(
        this.props.t(
          "Broken data detected, please click the setting button to reset the sync records"
        )
      );
      return false;
    }
    if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
      toast.loading(
        this.props.t("Start syncing") +
          " (" +
          this.props.t(
            driveList.find(
              (item) => item.value === ConfigService.getItem("defaultSyncOption")
            )?.label || ""
          ) +
          ")",
        { id: "syncing", position: "bottom-center" }
      );
    }

    return true;
  };
  getCompareResult = async () => {
    let localSyncRecords = ConfigService.getAllSyncRecord();
    let cloudSyncRecords = await ConfigUtil.getCloudConfig("sync");
    return await SyncHelper.compareAll(
      localSyncRecords,
      cloudSyncRecords,
      ConfigService,
      TokenService,
      ConfigUtil
    );
  };
  handleSyncStateChange = (isSyncing: boolean) => {
    this.setState({ isSync: isSyncing });
  };
  handleCloudSync = async (_userInfo?: any): Promise<false | undefined> => {
    if (this.isSyncing) {
      console.info("Sync already in progress, skipping...");
      return false;
    }
    this.isSyncing = true;

    try {
      this.timer = await showTaskProgress(this.handleSyncStateChange);
      if (!this.timer) {
        this.setState({ isSync: false });
        this.handleKOReaderSync();
        return false;
      }

      let res = await this.beforeSync();
      if (!res) {
        clearInterval(this.timer);
        this.setState({ isSync: false });
        this.handleKOReaderSync();
        return false;
      }
      let compareResult = await this.getCompareResult();
      await this.handleSync(compareResult);
      clearInterval(this.timer);
      this.setState({ isSync: false });
      this.handleKOReaderSync();
    } catch (error) {
      console.error(error);
      toast.error(
        this.props.t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );
      clearInterval(this.timer);
      this.setState({ isSync: false });
      this.handleKOReaderSync();
      return false;
    } finally {
      this.isSyncing = false;
    }
    setTimeout(() => {
      toast.dismiss("syncing");
    }, 3000);
    return;
  };
  handleSuccess = async () => {
    if (ConfigService.getItem("isFinshReading") !== "yes" || !isElectron) {
      this.props.handleFetchBooks();
    }

    this.props.handleFetchBookmarks();
    this.props.handleFetchNotes();

    if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
      toast.success(this.props.t("Synchronisation successful"), {
        id: "syncing",
      });
    }

    setTimeout(() => {
      if (this.props.mode === "home") {
        this.props.history.push("/manager/home");
      }
    }, 1000);
  };
  handleSync = async (compareResult) => {
    try {
      let tasks = await SyncHelper.startSync(
        compareResult,
        ConfigService,
        DatabaseService,
        ConfigUtil,
        BookUtil,
        CoverUtil
      );
      await SyncHelper.runTasksWithLimit(
        tasks,
        99,
        ConfigService.getItem("defaultSyncOption")
      );

      clearInterval(this.timer);
      this.setState({ isSync: false });
      let stats = await getTaskStats();
      if (stats.hasFailedTasks) {
        toast.error(
          this.props.t(
            "Tasks failed after multiple retries, please check the network connection or reauthorize the data source in the settings"
          ),
          {
            id: "syncing",
            duration: 6000,
          }
        );
        return;
      }
      if (ConfigService.getReaderConfig("hideSyncProgress") !== "yes") {
        toast.loading(this.props.t("Almost finished"), {
          id: "syncing",
          position: "bottom-center",
        });
      }
      await this.handleSuccess();
    } catch (error) {
      console.error(error);
      clearInterval(this.timer);
      this.setState({ isSync: false });
      toast.error(
        this.props.t("Sync failed") +
          ": " +
          (error instanceof Error ? error.message : String(error))
      );

      return;
    }
  };

  render() {
    return (
      <div
        className="header"
        style={this.props.isCollapsed ? { marginLeft: "40px" } : {}}
      >
        <div
          className="header-search-container"
          style={this.props.isCollapsed ? { width: "369px" } : {}}
        >
          <SearchBox />
        </div>
        <div
          className="setting-icon-parrent"
          style={this.props.isCollapsed ? { marginLeft: "430px" } : {}}
        >
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSortDisplay(!this.props.isSortDisplay);
            }}
            onMouseLeave={() => {
              this.props.handleSortDisplay(false);
            }}
            style={{ top: "18px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sort by")}
              data-tooltip-place="left"
            >
              <span className="icon-sort-desc header-sort-icon"></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={() => {
              this.props.handleSetting(true);
              this.props.handleAbout(false);
            }}
            onMouseLeave={() => {
              this.props.handleAbout(false);
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Setting")}
              data-tooltip-place="left"
            >
              <span
                className="icon-setting setting-icon"
                style={{ fontSize: "25px" }}
              ></span>
            </span>
          </div>
          <div
            className="setting-icon-container"
            onClick={async () => {
              if (!ConfigService.getItem("defaultSyncOption")) {
                toast(
                  this.props.t(
                    "Please add data source in the setting-Sync and backup first"
                  )
                );
                this.props.handleSetting(true);
                this.props.handleSettingMode("sync");
                return;
              }
              this.setState({ isSync: true });
              await this.handleCloudSync();
            }}
            style={{ marginTop: "2px" }}
          >
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={this.props.t("Sync")}
              data-tooltip-place="left"
            >
              <span
                className={
                  "icon-sync setting-icon" +
                  (this.state.isSync ? " icon-rotate" : "")
                }
                style={{ fontSize: "25px" }}
              ></span>
            </span>
          </div>
        </div>

        {/* Official account, upgrade, notification, and support UI is disabled
            in the portable build. It must not route to Koodo services. */}
        {/*
        {!this.props.isAuthed &&
        !this.state.isHidePro &&
        window.location.hostname !== "web.koodoreader.cn" ? (
          <div className="header-report-container">
            <span
              style={{ textDecoration: "underline" }}
              onClick={() => {
                if (
                  window.location.hostname !== "web.koodoreader.com" &&
                  !isElectron
                ) {
                  this.props.handleSetting(true);
                  this.props.handleSettingMode("account");
                  return;
                }
                this.props.history.push("/login");
              }}
            >
              <Trans>Pro version</Trans>
              <span> </span>
            </span>

            <span
              className="icon-close icon-pro-close"
              onClick={() => {
                ConfigService.setReaderConfig("isHidePro", "yes");
                this.setState({ isHidePro: true });
              }}
            ></span>
          </div>
        ) : null}
        {this.props.isAuthed &&
        this.props.userInfo &&
        ((this.props.userInfo.type === "pro" &&
          this.props.userInfo.valid_until <
            new Date().getTime() / 1000 + 30 * 24 * 3600) ||
          (this.props.userInfo.type === "trial" &&
            this.props.userInfo.valid_until <
              new Date().getTime() / 1000 + 3 * 24 * 3600)) ? (
          <div className="header-report-container">
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={i18n.t("Your trial will expire in", {
                ttl: Math.ceil(
                  (this.props.userInfo.valid_until -
                    new Date().getTime() / 1000) /
                    (24 * 3600)
                ),
              })}
            >
              <span
                style={{ textDecoration: "underline" }}
                onClick={async () => {
                  let response = await getTempToken();
                  if (response.code === 200) {
                    let tempToken = response.data.access_token;
                    let deviceUuid = await TokenService.getFingerprint();
                    openInBrowser(
                      getWebsiteUrl() +
                        (ConfigService.getReaderConfig("lang").startsWith("zh")
                          ? "/zh"
                          : "/en") +
                        "/pricing?temp_token=" +
                        tempToken +
                        "&device_uuid=" +
                        deviceUuid
                    );
                  } else if (response.code === 401) {
                    this.props.handleFetchAuthed();
                  }
                }}
              >
                <Trans>Renew Pro</Trans>
              </span>
            </span>
          </div>
        ) : null}
        {this.props.isAuthed &&
        this.props.userInfo &&
        this.props.userInfo.type === "trial" &&
        this.props.userInfo.valid_until >
          new Date().getTime() / 1000 + 3 * 24 * 3600 ? (
          <div className="header-report-container" style={{ right: "200px" }}>
            <span
              data-tooltip-id="my-tooltip"
              data-tooltip-content={i18n.t("Your trial will expire in", {
                ttl: Math.ceil(
                  (this.props.userInfo.valid_until -
                    new Date().getTime() / 1000) /
                    (24 * 3600)
                ),
              })}
            >
              <span
                style={{ textDecoration: "underline" }}
                onClick={async () => {
                  let response = await getTempToken();
                  if (response.code === 200) {
                    let tempToken = response.data.access_token;
                    let deviceUuid = await TokenService.getFingerprint();
                    openInBrowser(
                      getWebsiteUrl() +
                        (ConfigService.getReaderConfig("lang").startsWith("zh")
                          ? "/zh"
                          : "/en") +
                        "/pricing?temp_token=" +
                        tempToken +
                        "&device_uuid=" +
                        deviceUuid
                    );
                  } else if (response.code === 401) {
                    this.props.handleFetchAuthed();
                  }
                }}
              >
                <Trans>In trial</Trans>
              </span>
            </span>
          </div>
        ) : null}
        {KookitConfig.CloudMode !== "production" ? (
          <div className="header-report-container" style={{ right: "300px" }}>
            <span
              style={{
                color: "red",
                opacity: 1,
                fontWeight: "bold",
              }}
            >
              <Trans>TEST</Trans>
              <span> </span>
            </span>
          </div>
        ) : null}
        */}

        <ImportLocal
          {...({
            handleDrag: this.props.handleDrag,
          } as any)}
        />
      </div>
    );
  }
}

export default Header;
