import { spawn } from 'node:child_process';
import { chmod, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, '..');
const outputDirectory = resolve(projectDirectory, 'thirdparty/bergamot/build');

export async function buildThirdparty() {
  await mkdir(outputDirectory, { recursive: true });
  await chmod(outputDirectory, 0o777);

  await new Promise((resolvePromise, reject) => {
    const child = spawn(
      'docker',
      ['compose', 'run', '--rm', 'bergamot', 'make', 'build'],
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
      reject(new Error(`Bergamot build failed with ${status}`));
    });
  });
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  buildThirdparty().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
