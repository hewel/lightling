import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareExtensionAssets } from './prepareExtensionAssets.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const extensionBinary = resolve(projectDirectory, 'node_modules/.bin/extension');
const chromiumUpdateUrl = 'https://hewel.github.io/lightling/chromium_updates.xml';
const firefoxStandaloneId = '{33b518c2-1f65-4090-8d94-e0a432ebbfd4}';
const variantBrowsers = new Map([
  ['chrome', 'chrome'],
  ['chromium', 'chromium'],
  ['firefox', 'firefox'],
  ['firefox-standalone', 'firefox'],
]);

function runExtensionBuild(browser) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      extensionBinary,
      ['build', `--browser=${browser}`, '--mode=production'],
      {
        cwd: projectDirectory,
        stdio: 'inherit',
      },
    );

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }

      const status = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`Extension.js build failed with ${status}`));
    });
  });
}

async function patchGeneratedManifest(variant, outputDirectory) {
  const generatedManifestPath = resolve(outputDirectory, 'manifest.json');
  const manifest = JSON.parse(await readFile(generatedManifestPath, 'utf8'));

  if (variant === 'chromium') {
    manifest['update_url'] = chromiumUpdateUrl;
  }

  if (variant === 'firefox-standalone') {
    manifest['browser_specific_settings'] = {
      ...manifest['browser_specific_settings'],
      gecko: {
        ...manifest['browser_specific_settings']?.gecko,
        id: firefoxStandaloneId,
      },
    };
  }

  await writeFile(generatedManifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
}

export async function buildExtensionVariant(variant) {
  const browser = variantBrowsers.get(variant);

  if (!browser) {
    throw new Error(
      `Invalid extension variant ${JSON.stringify(variant)}. ` +
        `Expected one of: ${[...variantBrowsers.keys()].join(', ')}`,
    );
  }

  await prepareExtensionAssets({ requireThirdparty: true });
  await runExtensionBuild(browser);

  const sourceDirectory = resolve(projectDirectory, 'dist', browser);
  const outputDirectory = resolve(projectDirectory, 'build', variant);

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(dirname(outputDirectory), { recursive: true });
  await cp(sourceDirectory, outputDirectory, { recursive: true });
  await patchGeneratedManifest(variant, outputDirectory);
}

export default buildExtensionVariant;

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const argumentsList = process.argv.slice(2);

  if (argumentsList.length !== 1) {
    console.error(
      'Usage: node scripts/buildExtensionVariant.mjs ' +
        '<chrome|chromium|firefox|firefox-standalone>',
    );
    process.exitCode = 1;
  } else {
    buildExtensionVariant(argumentsList[0]).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
