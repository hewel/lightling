# Development and release builds

The extension is developed, bundled, and packaged with [Extension.js](https://extension.js.org/). Docker is used only to compile the embedded Bergamot translator.

## Prerequisites

For local extension development, install:

- Node.js 22.12 or newer
- npm
- A supported browser

The full release build additionally requires Docker with Docker Compose. Bergamot release builds target AMD64; ARM hosts use Docker's AMD64 emulation configured in `docker-compose.yml`.

## Local development

Install the dependencies:

```sh
npm install
```

Start the default Extension.js development server:

```sh
npm run dev
```

To launch another browser through the same asset-preparation flow:

```sh
npm run dev:firefox
npm run dev:chromium
```

The interface uses ASTRYX with the neutral theme. Before changing UI, use the
project-local CLI to discover the supported components, layouts, and tokens:

```sh
npx astryx build "describe the interface"
npx astryx component ComponentName
npx astryx docs tokens
```

Run `npx astryx doctor` after changing ASTRYX dependencies or theme wiring.
The generated conventions in `AGENTS.md` are the source of truth for new UI.
`npm run prepare:extension` also refreshes the compiler-safe neutral theme CSS;
do not edit `src/themes/astryx-neutral.css` directly.

To debug on Android, first stage the Firefox variant with `npm run build:variant -- firefox`, then run `npm run dev:android:firefox`. The Android command loads the extension from `build/firefox`. See the [Android debugging instructions](./AndroidDebug.md) for device setup.

To make a custom translator, see the [translator API](../CustomTranslator.md).

## Production builds

Build and package every release target:

```sh
npm run package
```

This compiles Bergamot in Docker, builds all extension variants with Extension.js, creates the ZIP archives, and validates the staged builds. The output contains both unpacked directories and store-ready archives:

- `build/firefox/` and `build/firefox.zip`
- `build/firefox-standalone/` and `build/firefox-standalone.zip`
- `build/chromium/` and `build/chromium.zip`
- `build/chrome/` and `build/chrome.zip`

When Bergamot is already available under `thirdparty/bergamot/build`, package only the extension targets:

```sh
npm run package:extensions
```

To rebuild Bergamot independently, run `npm run build:thirdparty`. To build and package one browser variant:

```sh
npm run build:variant -- firefox
```

The supported variants are `firefox`, `firefox-standalone`, `chromium`, and `chrome`. Extension.js writes each variant archive directly; no separate Make or ZIP step is required.

## Tests

When code touches user data and interacts with browser storage (`localStorage`, `indexedDB`, `browser.storage`, etc.) or an external API, add or update tests. As a general rule, transformations of data should be covered by tests. UI-only changes may not require data tests.

## Migrations

Migrations must include an app version.
