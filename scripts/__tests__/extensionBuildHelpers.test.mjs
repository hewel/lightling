import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, test } from 'vitest';

import {
  withoutInjectedContentStyles,
  withBuildVariantMetadata,
} from '../../extension.config.mjs';

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('extension build helpers', () => {
  test('requires the vivid theme in emitted UI CSS bundles', async () => {
    const projectDirectory = await mkdtemp(
      join(tmpdir(), 'lightling-extension-theme-artifact-'),
    );
    temporaryDirectories.push(projectDirectory);
    const actionStylesDirectory = resolve(projectDirectory, 'action');
    const contentStylesDirectory = resolve(projectDirectory, 'content_scripts');
    await Promise.all([
      mkdir(actionStylesDirectory, { recursive: true }),
      mkdir(contentStylesDirectory, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(resolve(projectDirectory, '304.css'), '.unused-content-style{}'),
      writeFile(
        resolve(actionStylesDirectory, 'index.css'),
        '@layer astryx-theme{}[data-astryx-theme=vivid]{}[data-astryx-theme=vivid] .astryx-button.destructive{}',
      ),
      writeFile(
        resolve(contentStylesDirectory, 'content-0.css'),
        '@layer  astryx-theme{}[data-astryx-theme="vivid"]{}',
      ),
    ]);

    await expect(findAstryxThemeArtifactProblems(projectDirectory)).resolves.toEqual([
      'content_scripts/content-0.css is missing the Astryx vivid component overrides',
    ]);

    await writeFile(
      resolve(contentStylesDirectory, 'content-0.css'),
      '@layer astryx-theme{}[data-astryx-theme="vivid"]{}[data-astryx-theme="vivid"] .astryx-button.destructive{}',
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
  test('syncs prerelease versions into store-valid manifest versions', async () => {
    const projectDirectory = await createTemporaryProject('syncManifestVersion.mjs');
    const sourceManifest = {
      manifest_version: 3,
      name: '__MSG_appName__',
      version: '7.1.0',
    };

    await mkdir(resolve(projectDirectory, 'src'), { recursive: true });
    await Promise.all([
      writeFile(
        resolve(projectDirectory, 'package.json'),
        JSON.stringify({ version: '7.2.0-beta.1' }),
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

    const syncedManifest = JSON.parse(
      await readFile(resolve(projectDirectory, 'src/manifest.json'), 'utf8'),
    );
    expect(syncedManifest).toEqual({
      ...sourceManifest,
      version: '7.1.65535.2',
      version_name: '7.2.0-beta.1',
    });
  });

  test('adds the update URL only to Chromium release metadata', () => {
    const sourceManifest = {
      manifest_version: 3,
      name: '__MSG_appName__',
      version: '7.1.0',
    };

    expect(withBuildVariantMetadata(sourceManifest, 'chromium')).toEqual({
      ...sourceManifest,
      update_url: 'https://hewel.github.io/lightling/chromium_updates.xml',
    });
    expect(withBuildVariantMetadata(sourceManifest, 'chrome')).toBe(sourceManifest);
  });

  test('sets the standalone Firefox ID while preserving other settings', () => {
    const sourceManifest = {
      manifest_version: 2,
      name: '__MSG_appName__',
      version: '7.1.0',
      browser_specific_settings: {
        gecko: { strict_min_version: '109.0' },
        safari: { strict_min_version: '17.0' },
      },
    };

    expect(withBuildVariantMetadata(sourceManifest, 'firefox-standalone')).toEqual({
      ...sourceManifest,
      browser_specific_settings: {
        gecko: {
          strict_min_version: '109.0',
          id: '{33b518c2-1f65-4090-8d94-e0a432ebbfd4}',
        },
        safari: { strict_min_version: '17.0' },
      },
    });
  });
});
