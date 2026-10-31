import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const forbidden = [
  /\bTURSO_AUTH_TOKEN\b/,
  /\bELEVENLABS_API_KEY\b/,
  /\bADMIN_PASSWORD_HASH\b/,
  /\bSESSION_SECRET\b/,
  /\bsk_[A-Za-z0-9_-]{12,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
/** @type {string[]} */
const files = [];
/** @param {string} directory */
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else files.push(path);
  }
}
await visit(root);
const matches = [];
for (const path of files) {
  const contents = await readFile(path, 'utf8');
  for (const pattern of forbidden) if (pattern.test(contents)) matches.push(`${path}: matched ${pattern}`);
}
if (matches.length) {
  console.error(matches.join('\n'));
  process.exitCode = 1;
} else console.log(`Scanned ${files.length} built files; no secret patterns or key names found.`);
