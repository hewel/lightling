# Development and release builds

The extension is developed and bundled with [Extension.js](https://extension.js.org/). The release workflow also uses Docker to build the embedded Bergamot translator and produce the browser-specific archives.

## Prerequisites

For local extension development, install:

- Node.js 22.12 or newer
- npm
- A supported browser

The full release build additionally requires:

- A Unix-like operating system (Linux, macOS, BSD, etc.)
- make
- Docker with Docker Compose

Release builds currently target AMD64. ARM platforms are not tested and may require AMD64 emulation. With Docker, you can set `DOCKER_DEFAULT_PLATFORM=linux/amd64` or add `platform: linux/amd64` to `docker-compose.yml`.

## Local development

Install the dependencies:

```sh
npm install
```

Start the default Extension.js development server:

```sh
npm run dev
```

The equivalent Make target is `make dev`. To launch a specific browser, use one of the explicit targets:

```sh
make devFirefox
make devChromium
make devChrome
```

Each browser-specific target prepares the extension assets and runs `extension dev` with the matching `--browser` option. The same flow can be run directly, for example:

```sh
npm run prepare:extension
npx extension dev --browser=firefox
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

To debug on Android, first stage the Firefox variant with `make buildFirefox`, then run `make devAndroidFirefox`. The Android command loads the extension from `build/firefox`. See the [Android debugging instructions](./AndroidDebug.md) for device setup.

To make a custom translator, see the [translator API](../CustomTranslator.md).

## Production builds

Create a `.env` file by copying `.env.example` and configure it as needed. Then run:

```sh
make build
```

This builds Bergamot in Docker, builds all extension variants in the Node builder container, packages the results, and validates the release archives. The staged extension directories retain the release layout expected by the packaging scripts:

- `build/firefox`
- `build/firefox-standalone`
- `build/chromium`
- `build/chrome`

To build only one variant after installing dependencies and building Bergamot, use its Make target. For example:

```sh
make prepare buildThirdparty buildFirefox
```

The available production targets are `buildFirefox`, `buildFirefoxStandalone`, `buildChromium`, and `buildChrome`. Each delegates to the corresponding Extension.js variant build; the direct npm form is:

```sh
npm run build:variant -- firefox
```

The supported variant arguments are `firefox`, `firefox-standalone`, `chromium`, and `chrome`.

## Tests

When code touches user data and interacts with browser storage (`localStorage`, `indexedDB`, `browser.storage`, etc.) or an external API, add or update tests. As a general rule, transformations of data should be covered by tests. UI-only changes may not require data tests.

## Migrations

Migrations must include an app version.
