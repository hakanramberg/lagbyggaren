import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.worker-assets');
fs.mkdirSync(out, { recursive: true });
// Explicit allowlist: never publish source files, local data, credentials or test fixtures.
for (const file of ['index.html', 'styles.css', 'app.js', 'team-image.js', 'engine.js', 'store.js', 'logo.png']) fs.copyFileSync(path.join(root, file), path.join(out, file));
fs.writeFileSync(path.join(out, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
`);
console.log('Cloudflare assets prepared.');
