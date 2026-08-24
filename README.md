# Lightling

![Lightling — Translate the web. Keep your privacy.](./assets/stores/chrome/promo-tile-marquee.png)

Lightling is a privacy-first browser extension for translating web pages, selected text, subtitles, messages, and custom input. It supports offline translation, custom translation backends, text-to-speech, translation history, and a personal dictionary.

> **Lightling is a fork of [Linguist](https://github.com/vitonsky/linguist). Most of the functionality is implemented by Linguist** — created by Robert Vitonsky and its contributors. This fork builds on their work.

## Features

- Full-page, selected-text, subtitle, message, and free-form text translation
- Built-in and custom translation services
- Offline translation with [Bergamot](https://github.com/browsermt/bergamot-translator)
- Personal dictionary and translation history
- Text-to-speech
- Automatic translation rules

See the [custom translator](./docs/CustomTranslator.md), [custom TTS](./docs/CustomTTS.md), and [offline translation](./docs/guides/OfflineTranslation.md) guides for configuration details.

## Installation

Download packaged builds from [Lightling releases](https://github.com/hewel/lightling/releases), or build the extension locally:

```sh
npm install
npm run build
```

The browser extension is emitted under `dist/`.

## Development

Install Node.js 22.12 or later, then run:

```sh
npm install
npm run dev
```

Use `npm test`, `npm run typecheck`, and `npm run lint` for validation.

## Screenshots

<table>
  <tr>
    <td><img src="./assets/stores/chrome/screenshots/01-popup.png" alt="Translate any page, in one click"></td>
    <td><img src="./assets/stores/chrome/screenshots/02-selection-popup.png" alt="Select text, get the translation"></td>
  </tr>
  <tr>
    <td><img src="./assets/stores/chrome/screenshots/03-full-page-translation.png" alt="One click translates the whole page"></td>
    <td><img src="./assets/stores/chrome/screenshots/05-settings.png" alt="Choose how every word is translated"></td>
  </tr>
  <tr>
    <td><img src="./assets/stores/chrome/screenshots/06-dictionary.png" alt="Turn quick lookups into lasting vocabulary"></td>
    <td><img src="./assets/stores/chrome/screenshots/07-history.png" alt="Every translation, remembered"></td>
  </tr>
</table>

## Upstream and license

Lightling is a fork of [Linguist](https://github.com/vitonsky/linguist), created by Robert Vitonsky and its contributors.

The project is distributed under the BSD 3-Clause License. The original copyright notice, license conditions, and disclaimer are retained in [LICENSE](./LICENSE), as required by that license. The Linguist name and contributor names are not used to imply endorsement of Lightling.
