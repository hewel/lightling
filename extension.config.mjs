import fs from 'node:fs';
import { join } from 'node:path';

import stylexPlugin from '@stylexjs/unplugin';

const chromiumUpdateUrl = 'https://hewel.github.io/lightling/chromium_updates.xml';
const firefoxStandaloneId = '{33b518c2-1f65-4090-8d94-e0a432ebbfd4}';

export function withoutInjectedContentStyles(manifest) {
  let isChanged = false;
  const contentScripts = (manifest['content_scripts'] ?? []).map((contentScript) => {
    if (!Object.hasOwn(contentScript, 'css')) return contentScript;

    const { css: _css, ...contentScriptWithoutCss } = contentScript;
    isChanged = true;
    return contentScriptWithoutCss;
  });

  return isChanged ? { ...manifest, ['content_scripts']: contentScripts } : manifest;
}
export function withBuildVariantMetadata(manifest, variant) {
  if (variant === 'chromium') {
    return { ...manifest, update_url: chromiumUpdateUrl };
  }

  if (variant === 'firefox-standalone') {
    return {
      ...manifest,
      browser_specific_settings: {
        ...manifest.browser_specific_settings,
        gecko: {
          ...manifest.browser_specific_settings?.gecko,
          id: firefoxStandaloneId,
        },
      },
    };
  }

  return manifest;
}

class GeneratedManifestPlugin {
  static pluginName = 'GeneratedManifestPlugin';

  apply(compiler) {
    // Extension.js adds imported content-script styles during processAssets.
    // Its persistence plugin then rewrites manifest.json after emit. Patch the
    // final manifest before Extension.js packages it in the done hook.
    compiler.hooks.afterEmit.tap(
      {
        name: GeneratedManifestPlugin.pluginName,
        stage: Number.MAX_SAFE_INTEGER,
      },
      (compilation) => {
        if (compilation.errors.length > 0) return;

        const outputPath = compilation.outputOptions.path;
        if (!outputPath) return;

        const manifestPath = join(outputPath, 'manifest.json');
        const manifestSource = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestSource);
        const manifestWithoutInjectedStyles = withoutInjectedContentStyles(manifest);
        const patchedManifest = withBuildVariantMetadata(
          manifestWithoutInjectedStyles,
          process.env.LIGHTLING_BUILD_VARIANT,
        );
        if (patchedManifest === manifest) return;

        const temporaryManifestPath = join(
          outputPath,
          `.manifest.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
        );

        try {
          fs.writeFileSync(
            temporaryManifestPath,
            `${JSON.stringify(patchedManifest, null, 2)}\n`,
            'utf8',
          );
          fs.renameSync(temporaryManifestPath, manifestPath);
        } finally {
          if (fs.existsSync(temporaryManifestPath)) {
            fs.unlinkSync(temporaryManifestPath);
          }
        }
      },
    );
  }
}

export default {
  perfBudgets: {
    'content-script': 1024 * 1024,
    'service-worker': 768 * 1024,
    runtime: 6 * 1024 * 1024,
  },
  config(config) {
    config.module ??= { rules: [] };
    config.module.rules ??= [];
    config.module.rules.push({
      test: /\.svg$/i,
      use: ['@svgr/webpack'],
    });
    config.plugins ??= [];
    config.plugins.push(stylexPlugin.rspack());
    config.plugins.push(new GeneratedManifestPlugin());

    return config;
  },
};
