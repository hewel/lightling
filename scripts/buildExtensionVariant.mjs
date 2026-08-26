import { spawn } from 'node:child_process';
import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareExtensionAssets } from './prepareExtensionAssets.mjs';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const extensionBinary = resolve(projectDirectory, 'node_modules/.bin/extension');
export const extensionVariants = new Map([
  ['chrome', 'chrome'],
  ['chromium', 'chromium'],
  ['firefox', 'firefox'],
  ['firefox-standalone', 'firefox'],
]);

function runExtensionBuild(variant, browser) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      extensionBinary,
      ['build', `--browser=${browser}`, '--zip', `--zip-filename=${variant}.zip`],
      {
        cwd: projectDirectory,
        env: { ...process.env, LIGHTLING_BUILD_VARIANT: variant },
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

async function buildPreparedExtensionVariant(variant, browser) {
  const sourceDirectory = resolve(projectDirectory, 'dist', browser);
  const sourceArchive = resolve(sourceDirectory, `${variant}.zip`);
  const outputDirectory = resolve(projectDirectory, 'build', variant);
  const outputArchive = resolve(projectDirectory, 'build', `${variant}.zip`);

  await Promise.all([
    rm(sourceDirectory, { recursive: true, force: true }),
    rm(outputDirectory, { recursive: true, force: true }),
    rm(outputArchive, { force: true }),
  ]);
  await runExtensionBuild(variant, browser);
  await mkdir(dirname(outputDirectory), { recursive: true });
  await cp(sourceDirectory, outputDirectory, {
    recursive: true,
    filter: (path) => path !== sourceArchive,
  });
  await rename(sourceArchive, outputArchive);
}

export async function buildExtensionVariant(variant) {
  const browser = extensionVariants.get(variant);

  if (!browser) {
    throw new Error(
      `Invalid extension variant ${JSON.stringify(variant)}. ` +
        `Expected one of: ${[...extensionVariants.keys()].join(', ')}`,
    );
  }

  await prepareExtensionAssets({ requireThirdparty: true });
  await buildPreparedExtensionVariant(variant, browser);
}

export async function buildAllExtensionVariants() {
  await Promise.all([
    rm(resolve(projectDirectory, 'build'), { recursive: true, force: true }),
    rm(resolve(projectDirectory, 'dist'), { recursive: true, force: true }),
  ]);
  await prepareExtensionAssets({ requireThirdparty: true });

  for (const [variant, browser] of extensionVariants) {
    await buildPreparedExtensionVariant(variant, browser);
  }
}

export default buildExtensionVariant;

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const argumentsList = process.argv.slice(2);

  const build =
    argumentsList.length === 0
      ? buildAllExtensionVariants
      : () => buildExtensionVariant(argumentsList[0]);

  if (argumentsList.length > 1) {
    console.error(
      'Usage: node scripts/buildExtensionVariant.mjs ' +
        '[chrome|chromium|firefox|firefox-standalone]',
    );
    process.exitCode = 1;
  } else {
    build().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  }
}
