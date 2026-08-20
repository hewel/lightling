import { execFile } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';

import { withoutInjectedContentStyles } from '../../extension.config.mjs';

import { findAstryxThemeArtifactProblems } from '../validateExtensionBuilds.mjs';

const scriptsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

async function createTemporaryProject(scriptName) {
  const projectDirectory = await mkdtemp(join(tmpdir(), 'lightling-extension-scripts-'));
  temporaryDirectories.push(projectDirectory);

  const projectScriptsDirectory = resolve(projectDirectory, 'scripts');
  await mkdir(projectScriptsDirectory, { recursive: true });
  await copyFile(
    resolve(scriptsDirectory, scriptName),
    resolve(projectScriptsDirectory, scriptName),
  );

  return projectDirectory;
}

async function invokeProjectExport(
  projectDirectory,
  scriptName,
  exportName,
  ...argumentsList
) {
  const runner = `
const [moduleUrl, exportName, ...serializedArguments] = process.argv.slice(1);
const module = await import(moduleUrl);
await module[exportName](...serializedArguments.map(JSON.parse));
`;

  await execFileAsync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      runner,
      pathToFileURL(resolve(projectDirectory, 'scripts', scriptName)).href,
      exportName,
      ...argumentsList.map((argument) => JSON.stringify(argument)),
    ],
    { cwd: projectDirectory },
  );
}

async function createVariantBuildProject(sourceManifest) {
  const projectDirectory = await createTemporaryProject('buildExtensionVariant.mjs');
  const extensionBinary = resolve(projectDirectory, 'node_modules/.bin/extension');

  await mkdir(dirname(extensionBinary), { recursive: true });
  await writeFile(
    resolve(projectDirectory, 'scripts/prepareExtensionAssets.mjs'),
    'export async function prepareExtensionAssets() {}\n',
  );
  await writeFile(
    resolve(projectDirectory, 'fixture-manifest.json'),
    JSON.stringify(sourceManifest),
  );
  await writeFile(
    extensionBinary,
    `#!/usr/bin/env node
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

(async () => {
	const browserArgument = process.argv.find((argument) =>
		argument.startsWith('--browser='),
	);
	const browser = browserArgument.split('=', 2)[1];
	const outputDirectory = resolve(process.cwd(), 'dist', browser);
	const manifest = await readFile(
		resolve(process.cwd(), 'fixture-manifest.json'),
		'utf8',
	);

	await mkdir(outputDirectory, { recursive: true });
	await writeFile(resolve(outputDirectory, 'manifest.json'), manifest);
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
`,
  );
  await chmod(extensionBinary, 0o755);

  return projectDirectory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('extension build helpers', () => {
  test('requires the neutral theme in every emitted CSS bundle', async () => {
    const projectDirectory = await mkdtemp(
      join(tmpdir(), 'lightling-extension-theme-artifact-'),
    );
    temporaryDirectories.push(projectDirectory);
    const contentStylesDirectory = resolve(projectDirectory, 'content_scripts');
    await mkdir(contentStylesDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(projectDirectory, 'action.css'),
        '@layer astryx-theme{}[data-astryx-theme=neutral]{}[data-astryx-theme=neutral] .astryx-button.destructive{}',
      ),
      writeFile(
        resolve(contentStylesDirectory, 'content-0.css'),
        '@layer  astryx-theme{}[data-astryx-theme="neutral"]{}',
      ),
    ]);

    await expect(findAstryxThemeArtifactProblems(projectDirectory)).resolves.toEqual([
      'content_scripts/content-0.css is missing the Astryx neutral component overrides',
    ]);

    await writeFile(
      resolve(contentStylesDirectory, 'content-0.css'),
      '@layer astryx-theme{}[data-astryx-theme="neutral"]{}[data-astryx-theme="neutral"] .astryx-button.destructive{}',
    );
    await expect(findAstryxThemeArtifactProblems(projectDirectory)).resolves.toEqual([]);
  });

  test('rejects artifacts without CSS bundles', async () => {
    const projectDirectory = await mkdtemp(
      join(tmpdir(), 'lightling-extension-empty-artifact-'),
    );
    temporaryDirectories.push(projectDirectory);
    await writeFile(resolve(projectDirectory, 'action.css.map'), '{}');

    await expect(findAstryxThemeArtifactProblems(projectDirectory)).resolves.toEqual([
      'build must emit at least one CSS bundle',
    ]);
  });

  test('keeps content styles web-accessible without injecting them into pages', () => {
    const webAccessibleResources = [
      {
        resources: ['content_scripts/content-0.css'],
        matches: ['*://*/*'],
      },
    ];
    const manifest = {
      content_scripts: [
        {
          matches: ['*://*/*'],
          js: ['content_scripts/content-0.js'],
          css: ['content_scripts/content-0.css'],
        },
      ],
      web_accessible_resources: webAccessibleResources,
    };

    expect(withoutInjectedContentStyles(manifest)).toEqual({
      content_scripts: [
        {
          matches: ['*://*/*'],
          js: ['content_scripts/content-0.js'],
        },
      ],
      web_accessible_resources: webAccessibleResources,
    });
    expect(manifest.content_scripts[0].css).toEqual(['content_scripts/content-0.css']);
  });

  test('syncs the package version into the source manifest', async () => {
    const projectDirectory = await createTemporaryProject('syncManifestVersion.mjs');
    const sourceManifest = {
      manifest_version: 3,
      name: '__MSG_appName__',
      version: '1.0.0',
      permissions: ['storage'],
    };
    const expectedManifest = { ...sourceManifest, version: '7.2.0' };

    await mkdir(resolve(projectDirectory, 'src'), { recursive: true });
    await Promise.all([
      writeFile(
        resolve(projectDirectory, 'package.json'),
        JSON.stringify({ version: '7.2.0' }),
      ),
      writeFile(
        resolve(projectDirectory, 'src/manifest.json'),
        JSON.stringify(sourceManifest),
      ),
    ]);

    await invokeProjectExport(
      projectDirectory,
      'syncManifestVersion.mjs',
      'syncManifestVersion',
    );

    const syncedManifest = await readFile(
      resolve(projectDirectory, 'src/manifest.json'),
      'utf8',
    );
    expect(syncedManifest).toBe(`${JSON.stringify(expectedManifest, null, '\t')}\n`);
  });

  test('adds the update URL only to the copied Chromium manifest', async () => {
    const sourceManifest = {
      manifest_version: 3,
      name: '__MSG_appName__',
      version: '7.1.0',
    };
    const projectDirectory = await createVariantBuildProject(sourceManifest);
    await invokeProjectExport(
      projectDirectory,
      'buildExtensionVariant.mjs',
      'buildExtensionVariant',
      'chromium',
    );

    const sourceBuildManifest = JSON.parse(
      await readFile(resolve(projectDirectory, 'dist/chromium/manifest.json'), 'utf8'),
    );
    const variantManifest = JSON.parse(
      await readFile(resolve(projectDirectory, 'build/chromium/manifest.json'), 'utf8'),
    );

    expect(sourceBuildManifest).toEqual(sourceManifest);
    expect(variantManifest).toEqual({
      ...sourceManifest,
      update_url: 'https://hewel.github.io/lightling/chromium_updates.xml',
    });
  });

  test('sets the standalone Firefox ID while preserving other settings', async () => {
    const sourceManifest = {
      manifest_version: 2,
      name: '__MSG_appName__',
      version: '7.1.0',
      browser_specific_settings: {
        gecko: { strict_min_version: '109.0' },
        safari: { strict_min_version: '17.0' },
      },
    };
    const projectDirectory = await createVariantBuildProject(sourceManifest);
    await invokeProjectExport(
      projectDirectory,
      'buildExtensionVariant.mjs',
      'buildExtensionVariant',
      'firefox-standalone',
    );

    const variantManifest = JSON.parse(
      await readFile(
        resolve(projectDirectory, 'build/firefox-standalone/manifest.json'),
        'utf8',
      ),
    );

    expect(variantManifest.browser_specific_settings).toEqual({
      gecko: {
        strict_min_version: '109.0',
        id: '{33b518c2-1f65-4090-8d94-e0a432ebbfd4}',
      },
      safari: { strict_min_version: '17.0' },
    });
  });
});
