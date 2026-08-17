import fs from 'node:fs';
import { join } from 'node:path';

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

class ShadowDomContentStylesPlugin {
	static pluginName = 'ShadowDomContentStylesPlugin';

	apply(compiler) {
		// Extension.js adds imported content-script styles during processAssets.
		// Its persistence plugin then rewrites manifest.json after emit, so patch the
		// on-disk manifest at the end of afterEmit on every build/watch iteration.
		compiler.hooks.afterEmit.tap(
			{
				name: ShadowDomContentStylesPlugin.pluginName,
				stage: Number.MAX_SAFE_INTEGER,
			},
			(compilation) => {
				if (compilation.errors.length > 0) return;

				const outputPath = compilation.outputOptions.path;
				if (!outputPath) return;

				const manifestPath = join(outputPath, 'manifest.json');
				const manifestSource = fs.readFileSync(manifestPath, 'utf8');
				const manifest = JSON.parse(manifestSource);
				const patchedManifest = withoutInjectedContentStyles(manifest);
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
	config(config) {
		config.module ??= { rules: [] };
		config.module.rules ??= [];
		config.module.rules.push({
			test: /\.svg$/i,
			use: ['@svgr/webpack'],
		});
		config.plugins ??= [];
		config.plugins.push(new ShadowDomContentStylesPlugin());

		return config;
	},
};
