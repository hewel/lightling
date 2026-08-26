# Store metadata

## Listing

**Name:** Lightling – web page translator

**Summary:** Privacy-first translation for web pages, selected text, subtitles, messages, and custom input.

**Description:**

Lightling translates complete web pages, selected text, subtitles, messages, and text entered in its popup. It supports multiple online translation services, an on-device offline translator, custom translation and text-to-speech modules, translation history, and a personal dictionary.

Lightling does not operate a telemetry or advertising service. Translation history, dictionary entries, settings, and configured credentials are stored in Firefox extension storage. When an online provider is selected, the text required for the translation is sent directly to that provider.

**Privacy policy:** https://github.com/hewel/lightling/blob/master/docs/Privacy.md

## Privacy and data use

Lightling declares `browser_specific_settings.gecko.data_collection_permissions.required` as `none` because the project does not collect or transmit data to a Lightling-operated service.

User-requested translation and text-to-speech content may be sent directly to the third-party provider selected by the user. The built-in Bergamot translator processes text locally. Custom modules and LLM integrations connect only to endpoints configured by the user.

## Firefox Add-ons

### Permission justification

- `storage`: stores settings, translation history, dictionary entries, cached translations, custom modules, and configured provider credentials in Firefox extension storage.
- `tabs`: identifies the active tab and coordinates page translation state.
- `contextMenus`: exposes user-invoked translation actions in Firefox context menus.
- `scripting`: injects the content script required to translate pages and selected text.
- `<all_urls>`: allows translation on pages explicitly visited by the user and permits requests to translation providers selected by the user.

### Reviewer notes

Lightling is built from the public source at https://github.com/hewel/lightling.

Build requirements:

- Node.js 22.12 or later
- Docker with Docker Compose

Build the submitted Firefox artifact from a clean checkout:

```sh
npm install
npm run build:thirdparty
npm run build:variant -- firefox-standalone
```

The resulting submission archive is `build/firefox-standalone.zip`; its unpacked contents remain under `build/firefox-standalone/`. The build compiles the bundled Bergamot WebAssembly translator from `thirdparty/bergamot` and packages the TypeScript/React application with Extension.js.

Lightling telemetry is disabled in `src/lib/telemetry/singleton.ts`. The website analytics inherited from upstream are also disabled.

### Release notes

Initial Lightling beta: renamed the project and extension, preserved the upstream BSD 3-Clause attribution, disabled upstream telemetry, added LLM translation providers, and refreshed the extension interface.

## Version history

- `7.1.1-beta.0`: first Lightling beta prepared for Firefox Add-ons review.
