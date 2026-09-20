import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'dist/client';
const files = [];
async function collect(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { const path = join(directory, entry.name); entry.isDirectory() ? await collect(path) : files.push(path); } }
await collect(root);
const bundle = (await Promise.all(files.filter(file => /\.(?:html|js|css)$/.test(file)).map(file => readFile(file, 'utf8')))).join('\n');
for (const forbidden of ['GITHUB_CLIENT_SECRET', 'ALERT_WEBHOOK_URL', 'test-client-secret', 'discord.com/api/webhooks/']) assert.equal(bundle.includes(forbidden), false, `Client bundle contains forbidden secret marker: ${forbidden}`);
console.log(`Client bundle secret scan passed (${files.length} files inspected).`);
