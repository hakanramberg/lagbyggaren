import './build-cloudflare.mjs';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
await build({ entryPoints: [path.join(root, 'cloudflare/worker.mjs')], outfile: path.join(root, '.worker-assets/_worker.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true });
fs.writeFileSync(path.join(root, '.worker-assets/_routes.json'), JSON.stringify({ version: 1, include: ['/api/*', '/config.js', '/health'], exclude: [] }));
console.log('Pages Functions prepared.');
