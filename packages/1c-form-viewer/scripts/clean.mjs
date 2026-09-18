import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(packageDir, 'build');
if (path.dirname(buildDir) !== packageDir || path.basename(buildDir) !== 'build') {
  throw new Error(`Refusing to clean unexpected directory: ${buildDir}`);
}
await rm(buildDir, { recursive: true, force: true });
