# Koodo Portable

This fork is an independent AGPL-3.0-or-later build. It does not emulate a
Koodo Pro account and it does not use Koodo account, entitlement, update,
notification, token-encryption, OCR, TTS, font, or plugin-market services.

## Data layout

Packaged builds create `Koodo Portable Data` next to the `.app` or `.exe`:

```text
Koodo Portable Data/
  Library/   books, covers, SQLite data, snapshots and AI cache
  Profile/   settings and the encrypted credential vault
  Runtime/   OCR and TTS temporary files
  Logs/
```

Move the application and this data directory together. The first launch can
copy an official Koodo library without modifying the source. When automatic
detection finds only an empty default library, choose the real library folder
manually; it is the folder containing `config/books.db`, `book/`, and `cover/`.

API keys and data-source passwords are encrypted with a master password using
scrypt and AES-256-GCM. The master password cannot be recovered. Normal library
backups exclude the vault; copy the complete portable directory or explicitly
export the encrypted vault when credentials must move with the library.

## Local capabilities

- AI translation, dictionary, chapter summary/outline and speech-role analysis
  use models configured by the user.
- OCR uses the operating system, Paddle, or Tesseract.
- Speech uses operating-system voices or locally imported voice plugins.
- Metadata uses Open Library first and Google Books as a fallback.
- Sync supports a local folder, a user-selected iCloud Drive folder, WebDAV,
  S3-compatible storage, Docker, MEGA, FTP, and SFTP.

Official Koodo domains are denied by a main-process network policy even if
legacy upstream code still contains an unreachable URL constant.

## Build

Use Node.js 22 and Yarn Classic:

```sh
yarn install
yarn build
yarn release:portable
```

To build only the standard macOS drag-to-Applications disk image:

```sh
yarn release:mac --arm64
```

macOS output is unsigned in the personal build. Windows must be built on
Windows or with the prebuilt Electron native dependency for the selected
architecture.

Source: <https://github.com/ok123now/koodo-portable>
