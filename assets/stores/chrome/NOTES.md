# Chrome Web Store upload order

1. **`screenshots/01-popup.png`** — Leads with the extension’s primary one-click page translation interface, language controls, per-site rules, and live translation report.
2. **`screenshots/02-selection-popup.png`** — Shows the fastest everyday workflow: translate selected text in place, then listen, copy, or save it.
3. **`screenshots/03-full-page-translation.png`** — Demonstrates a complete translated page with its layout preserved and translation progress visible.
4. **`screenshots/05-settings.png`** — Highlights Lightling’s differentiators: configurable services, custom LLM providers, and private on-device translation.
5. **`screenshots/06-dictionary.png`** — Shows the built-in personal dictionary for saving, filtering, and revisiting vocabulary offline.

Alternate assets: `screenshots/04-original-page.png` emphasizes switching back to the source page, while `screenshots/07-history.png` shows searchable translation history.

## Regenerating the assets

Run `npm run store:assets` from the repository root to update the checked-in assets, or `npm run store:assets -- --out <directory>` to render the same manifest into another directory. The generator reads the source captures from `screenshots-raw/`, the canonical extension logo from `src/res/logo.png`, and the package version from `package.json`. It uses the fonts installed on the machine that runs it.

The generator owns only its 20 named SVG and PNG outputs. It stages and validates the complete set before publication, replaces those files transactionally, and leaves unrelated files in the output directory untouched.

After regeneration, manually review all seven screenshots, both promotional tiles, and both icon sizes. In particular, confirm text rendering and cropping, the absence of decorative sequence numbers, the transparent padding around `icon-128.png`, and the upload order documented above. Visual approval is intentionally not automated.
