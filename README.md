# Koodo Portable（绿色独立版）

Koodo Portable is an independent community fork of
[Koodo Reader](https://github.com/koodo-reader/koodo-reader). It keeps the
reader and ebook-management experience while replacing account and Pro gates
with local capabilities or services configured by the user.

> This project does not impersonate a Koodo Pro account and does not call
> Koodo's paid APIs. It is not an official Koodo release.

## Highlights

- Independent application ID, URL protocol, profile and library.
- Portable data directory for books, notes, reading state and AI cache.
- User-configured AI translation, dictionary, chapter summary, outline and
  speech-role analysis.
- Full-text translation with structured output validation, retry and local
  SQLite caching.
- Local/system OCR and text-to-speech; no official OCR or voice quota.
- Self-hosted sync through WebDAV, S3-compatible storage, FTP, SFTP, MEGA,
  Docker, a local folder or a user-selected iCloud Drive folder.
- Runtime blocking of official Koodo service domains.
- Read-only migration from an existing Koodo library.

## Privacy and credentials

API keys and data-source passwords are not stored in this repository. At
runtime they are kept in an encrypted credential vault using scrypt and
AES-256-GCM. The master password cannot be recovered.

The repository ignores portable data, credential vaults, AI cache databases,
build output and private signing keys. Never commit `Koodo Portable Data`,
`.portable-data`, a credential-vault export, books or a personal environment
file.

Normal library backups exclude the credential vault. See [PORTABLE.md](PORTABLE.md)
for the data layout, migration details and supported local capabilities.

## Build

Use Node.js 22 and Yarn Classic:

```sh
yarn install
yarn build
```

Build the standard Apple Silicon macOS drag-to-Applications image:

```sh
yarn release:mac --arm64
```

Build the portable distribution targets:

```sh
yarn release:portable
```

Personal macOS builds are unsigned. On first launch, right-click the app and
choose **Open**.

## Source and license

This fork is distributed under **AGPL-3.0-or-later**. Modified source must
remain available when the program is distributed or offered as a network
service, as required by the license.

- Portable fork: <https://github.com/ok123now/koodo-portable>
- Upstream project: <https://github.com/koodo-reader/koodo-reader>
- Upstream authors and contributors retain copyright in their work.
