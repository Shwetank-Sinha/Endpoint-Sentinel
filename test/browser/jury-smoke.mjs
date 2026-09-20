import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const target = process.env.SENTINEL_TEST_URL || 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(target).hostname)) throw new Error('Jury smoke test is restricted to localhost');
const name = `Jury smoke ${Date.now()}`;
const browser = await chromium.launch({ channel: process.env.SENTINEL_BROWSER || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light', reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).hostname !== 'icons.duckduckgo.com') errors.push(`${response.status()} ${response.url()}`); });

async function cleanup() {
  await page.evaluate(async endpointName => {
    const session = await fetch('/api/auth/session').then(response => response.json());
    const workspaceId = session.data?.workspaces?.[0]?.id;
    if (!workspaceId) return;
    const headers = { 'X-Workspace-ID': workspaceId };
    const endpoints = await fetch('/api/endpoints', { headers }).then(response => response.json());
    for (const endpoint of endpoints.data ?? []) if (endpoint.name === endpointName) await fetch(`/api/endpoints/${encodeURIComponent(endpoint.id)}`, { method: 'DELETE', headers });
  }, name).catch(() => {});
}

try {
  await page.goto(target, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Operations overview' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Continue with GitHub' }).count(), 0);
  await page.getByText('Public jury evaluation mode', { exact: true }).waitFor();
  await page.getByText('Authentication is temporarily disabled for hackathon evaluation.', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Add endpoint', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'URL', exact: true }).fill('https://endpoint-sentinel.endpoint-sentinel.workers.dev/api/demo/healthy');
  await dialog.getByRole('button', { name: 'Add Endpoint', exact: true }).click();
  const row = page.getByRole('article', { name, exact: true });
  await row.waitFor();

  await row.getByRole('button', { name: 'Check now' }).click();
  await page.getByText(`${name} check completed.`, { exact: true }).waitFor({ timeout: 45_000 });
  await row.getByRole('button', { name: 'History' }).click();
  await page.getByRole('dialog').locator('.es-history__item').first().waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();

  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Pause monitoring' }).click();
  await row.getByText('Paused', { exact: true }).first().waitFor();
  await row.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Resume monitoring' }).click();

  await page.getByRole('link', { name: 'Incidents', exact: true }).click();
  await page.getByRole('heading', { name: 'Incidents', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Operations overview' }).waitFor();
  await page.getByRole('article', { name, exact: true }).waitFor();

  const reloaded = page.getByRole('article', { name, exact: true });
  await reloaded.getByRole('button', { name: `More actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Delete endpoint' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete Endpoint' }).click();
  await reloaded.waitFor({ state: 'detached' });
  await page.screenshot({ path: join(tmpdir(), 'endpoint-sentinel-jury-smoke.png'), scale: 'css' });
  assert.deepEqual(errors, []);
  console.log('Jury smoke passed: dashboard, add, check, poll, history, pause/resume, incidents, refresh, delete.');
} finally {
  await cleanup();
  await context.close();
  await browser.close();
}
