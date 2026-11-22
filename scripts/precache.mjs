import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'dist';
const files = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
for (const asset of await readdir(join(root, 'assets'))) files.push('/assets/' + asset);
for (const clip of await readdir(join(root, 'audio'))) files.push('/audio/' + clip);
const hash = createHash('sha256');
const worker = await readFile('scripts/service-worker.js', 'utf8');
hash.update(worker);
for (const file of files) hash.update(await readFile(join(root, file)));
await writeFile(join(root, 'sw.js'), 'const VERSION = ' + JSON.stringify(hash.digest('hex').slice(0, 16)) + ';\nconst FILES = ' + JSON.stringify(files) + ';\n' + worker);
