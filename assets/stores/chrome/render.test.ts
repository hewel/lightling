import { createHash } from 'node:crypto';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { parseRenderArgs, renderStoreAssets } from './render';

const projectDirectory = process.cwd();
const chromeStoreDirectory = resolve(projectDirectory, 'assets/stores/chrome');

const screenshotNames = [
  '01-popup',
  '02-selection-popup',
  '03-full-page-translation',
  '04-original-page',
  '05-settings',
  '06-dictionary',
  '07-history',
] as const;

const svgPaths = [
  ...screenshotNames.map((name) => `svg/${name}.svg`),
  'svg/promo-tile-small.svg',
  'svg/promo-tile-marquee.svg',
];

const pngContracts = [
  ...screenshotNames.map((name) => ({
    path: `screenshots/${name}.png`,
    width: 1280,
    height: 800,
    hasAlpha: false,
  })),
  { path: 'promo-tile-small.png', width: 440, height: 280, hasAlpha: false },
  {
    path: 'promo-tile-marquee.png',
    width: 1400,
    height: 560,
    hasAlpha: false,
  },
  { path: 'icon-128.png', width: 128, height: 128, hasAlpha: true },
  { path: 'icon-300.png', width: 300, height: 300, hasAlpha: true },
] as const;

const generatedPaths = [...svgPaths, ...pngContracts.map(({ path }) => path)].sort();
const temporaryDirectories: string[] = [];
const createTemporaryDirectory = async (prefix: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const collectRelativeFiles = async (
  rootDirectory: string,
  currentDirectory = rootDirectory,
): Promise<string[]> => {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(currentDirectory, entry.name);
      if (entry.isDirectory()) return collectRelativeFiles(rootDirectory, path);
      return [path.slice(rootDirectory.length + 1)];
    }),
  );
  return files.flat().sort();
};

const hashFiles = async (rootDirectory: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    await Promise.all(
      (await collectRelativeFiles(rootDirectory)).map(async (relativePath) => [
        relativePath,
        createHash('sha256')
          .update(await readFile(join(rootDirectory, relativePath)))
          .digest('hex'),
      ]),
    ),
  );

const expectNoStagingDirectories = async (parentDirectory: string): Promise<void> => {
  const entries = await readdir(parentDirectory);
  expect(entries.filter((name) => name.startsWith('.lightling-store-assets-'))).toEqual(
    [],
  );
};

afterAll(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('store asset render arguments', () => {
  test('supports the default, relative, and absolute output paths', () => {
    const cwd = resolve('/tmp', 'lightling-render-cwd');
    const absoluteOutput = resolve('/tmp', 'lightling-render-absolute');

    expect(parseRenderArgs([], cwd)).toBe(chromeStoreDirectory);
    expect(parseRenderArgs(['--out', 'relative-output'], cwd)).toBe(
      resolve(cwd, 'relative-output'),
    );
    expect(parseRenderArgs(['--out', absoluteOutput], cwd)).toBe(absoluteOutput);
  });

  test.each([
    ['--out'],
    ['--unknown', 'output'],
    ['--out', '--unknown'],
    ['one', 'two', 'three'],
  ])('rejects invalid arguments: %j', (...argumentsList: string[]) => {
    expect(() => parseRenderArgs(argumentsList, projectDirectory)).toThrow(
      'Usage: bun assets/stores/chrome/render.ts [--out <dir>]',
    );
  });
});

describe('store asset rendering', () => {
  let temporaryRoot: string;
  let outputDirectory: string;

  beforeAll(async () => {
    temporaryRoot = await createTemporaryDirectory('lightling-store-assets-test-');
    outputDirectory = join(temporaryRoot, 'output');
    await Promise.all([
      mkdir(join(outputDirectory, 'svg'), { recursive: true }),
      mkdir(join(outputDirectory, 'screenshots'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(outputDirectory, 'svg/manual.svg'), '<svg/>\n'),
      writeFile(join(outputDirectory, 'screenshots/manual.png'), 'manual image\n'),
    ]);

    await renderStoreAssets({ outputDirectory, projectDirectory });
  }, 30_000);

  test('publishes the exact manifest while preserving unrelated files', async () => {
    expect(await collectRelativeFiles(outputDirectory)).toEqual(
      [...generatedPaths, 'screenshots/manual.png', 'svg/manual.svg'].sort(),
    );
    await expect(readFile(join(outputDirectory, 'svg/manual.svg'), 'utf8')).resolves.toBe(
      '<svg/>\n',
    );
    await expect(
      readFile(join(outputDirectory, 'screenshots/manual.png'), 'utf8'),
    ).resolves.toBe('manual image\n');
    await expectNoStagingDirectories(temporaryRoot);
  });

  test('emits the declared PNG dimensions, alpha channels, and colour space', async () => {
    const sharp = (await import('sharp')).default;

    for (const contract of pngContracts) {
      const metadata = await sharp(join(outputDirectory, contract.path)).metadata();
      expect(metadata).toMatchObject({
        format: 'png',
        width: contract.width,
        height: contract.height,
        hasAlpha: contract.hasAlpha,
        space: 'srgb',
      });
    }
  });

  test('derives the display version and omits decorative screenshot numbers', async () => {
    const { version } = JSON.parse(
      await readFile(join(projectDirectory, 'package.json'), 'utf8'),
    ) as { version: string };
    const [major, minor] = version.split('.');
    await expect(
      readFile(join(outputDirectory, 'svg/promo-tile-marquee.svg'), 'utf8'),
    ).resolves.toContain(`>WEB TRANSLATOR · v${major}.${minor}</text>`);

    for (const name of screenshotNames) {
      const svg = await readFile(join(outputDirectory, `svg/${name}.svg`), 'utf8');
      expect(svg).not.toMatch(/>0[1-7]<\/text>/);
    }
  });

  test('rolls back a failed publication and removes its staging directory', async () => {
    const before = await hashFiles(outputDirectory);
    let renameCount = 0;
    const renameWithFailure: typeof rename = async (oldPath, newPath) => {
      renameCount += 1;
      if (renameCount === generatedPaths.length + 1) {
        throw new Error('simulated publication failure');
      }
      await rename(oldPath, newPath);
    };

    await expect(
      renderStoreAssets(
        { outputDirectory, projectDirectory },
        { renameFile: renameWithFailure },
      ),
    ).rejects.toThrow('simulated publication failure');

    expect(renameCount).toBeGreaterThan(generatedPaths.length);
    expect(await hashFiles(outputDirectory)).toEqual(before);
    await expectNoStagingDirectories(temporaryRoot);
  }, 30_000);

  test('uses the canonical project logo and package version inputs', async () => {
    const fixtureProject = await createTemporaryDirectory(
      'lightling-store-assets-fixture-',
    );
    const fixtureOutput = join(fixtureProject, 'rendered');
    await Promise.all([
      cp(
        join(projectDirectory, 'assets/stores/chrome/screenshots-raw'),
        join(fixtureProject, 'assets/stores/chrome/screenshots-raw'),
        { recursive: true },
      ),
      mkdir(join(fixtureProject, 'src/res'), { recursive: true }),
    ]);
    await Promise.all([
      copyFile(
        join(projectDirectory, 'src/res/logo.png'),
        join(fixtureProject, 'src/res/logo.png'),
      ),
      writeFile(join(fixtureProject, 'package.json'), '{"version":"9.4.3"}\n'),
    ]);

    await renderStoreAssets({
      outputDirectory: fixtureOutput,
      projectDirectory: fixtureProject,
    });

    await expect(readFile(join(fixtureOutput, 'icon-128.png'))).resolves.not.toHaveLength(
      0,
    );
    await expect(
      readFile(join(fixtureOutput, 'svg/promo-tile-marquee.svg'), 'utf8'),
    ).resolves.toContain('>WEB TRANSLATOR · v9.4</text>');
    await expectNoStagingDirectories(fixtureProject);
  }, 30_000);

  test('preserves recovery files when publication rollback is incomplete', async () => {
    const before = await hashFiles(outputDirectory);
    let renameCount = 0;
    const renameWithRollbackFailure: typeof rename = async (oldPath, newPath) => {
      renameCount += 1;
      if (
        renameCount === generatedPaths.length + 2 ||
        renameCount === generatedPaths.length + 3
      ) {
        throw new Error(
          renameCount === generatedPaths.length + 2
            ? 'simulated publication failure'
            : 'simulated rollback failure',
        );
      }
      await rename(oldPath, newPath);
    };

    let publicationError: unknown;
    try {
      await renderStoreAssets(
        { outputDirectory, projectDirectory },
        { renameFile: renameWithRollbackFailure },
      );
    } catch (error) {
      publicationError = error;
    }

    expect(publicationError).toBeInstanceOf(AggregateError);
    const stagingNames = (await readdir(temporaryRoot)).filter((name) =>
      name.startsWith('.lightling-store-assets-'),
    );
    expect(stagingNames).toHaveLength(1);
    const recoveryDirectory = join(temporaryRoot, stagingNames[0]);
    expect((publicationError as Error).message).toContain(recoveryDirectory);
    expect(
      createHash('sha256')
        .update(await readFile(join(recoveryDirectory, 'backup/icon-300.png')))
        .digest('hex'),
    ).toBe(before['icon-300.png']);
  }, 30_000);
});
