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

export async function syncManifestVersion() {
	const [packageJson, manifest] = await Promise.all([
		readJson(packagePath),
		readJson(manifestPath),
	]);

	manifest.version = packageJson.version;

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
