import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const packagePath = resolve(projectDirectory, 'package.json');
const manifestPath = resolve(projectDirectory, 'src/manifest.json');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}
const maximumManifestVersionPart = 65_535;
const packageVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+)\.(0|[1-9]\d*))?$/;

export function toManifestVersion(packageVersion) {
  const match = packageVersionPattern.exec(packageVersion);
  if (!match) {
    throw new Error(
      `Unsupported package version ${JSON.stringify(packageVersion)}. ` +
        'Expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-LABEL.NUMBER.',
    );
  }

  const versionParts = match.slice(1, 4).map(Number);
  if (versionParts.some((part) => part > maximumManifestVersionPart)) {
    throw new Error(
      `Package version ${JSON.stringify(packageVersion)} exceeds manifest limits`,
    );
  }

  const prereleaseNumber = match[5];
  if (prereleaseNumber === undefined) {
    return versionParts.join('.');
  }

  const manifestBuild = Number(prereleaseNumber) + 1;
  if (manifestBuild > maximumManifestVersionPart) {
    throw new Error(
      `Prerelease number in ${JSON.stringify(packageVersion)} exceeds manifest limits`,
    );
  }

  const decrementedPart = versionParts.findLastIndex((part) => part > 0);
  if (decrementedPart === -1) {
    throw new Error('A prerelease version must target a version newer than 0.0.0');
  }

  versionParts[decrementedPart]--;
  versionParts.fill(maximumManifestVersionPart, decrementedPart + 1);

  return [...versionParts, manifestBuild].join('.');
}

export async function syncManifestVersion() {
  const [packageJson, manifest] = await Promise.all([
    readJson(packagePath),
    readJson(manifestPath),
  ]);

  manifest.version = toManifestVersion(packageJson.version);
  if (manifest.version === packageJson.version) {
    delete manifest.version_name;
  } else {
    manifest.version_name = packageJson.version;
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
}

export default syncManifestVersion;

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  syncManifestVersion().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
