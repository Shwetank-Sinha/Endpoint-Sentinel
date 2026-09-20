import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createFixtures, installFixtures } from './fixtures.ts';

export const evidence = join(tmpdir(), 'sentinel-redesign-evidence');
const target = process.env.SENTINEL_TEST_URL || 'http://127.0.0.1:5173';
if (!['127.0.0.1', 'localhost'].includes(new URL(target).hostname)) throw new Error('Local test URL required');
const results = [];
const check = (theme, name) => { results.push({ theme, name, passed: true }); console.log(`PASS ${theme}: ${name}`); };
const dialog = page => page.getByRole('dialog').last();
async function reset(page, state) { Object.assign(state, createFixtures()); await page.goto(target); await page.getByRole('article', { name: 'API gateway', exact: true }).waitFor(); }
async function setup(browser, theme, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, colorScheme: theme, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
  const state = await installFixtures(context), page = await context.newPage();
  page.setDefaultTimeout(7000);
  const failures = [], consoleErrors = [], badResponses = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', request => { if (!request.failure()?.errorText.includes('ERR_ABORTED')) failures.push(request.url() + ': ' + request.failure()?.errorText); });
  page.on('response', response => { if (response.status() >= 400 && !response.url().includes('/api/')) badResponses.push(response.url()); });
  await page.goto(target); await page.getByRole('article', { name: 'API gateway', exact: true }).waitFor();
  return { context, state, page, failures, consoleErrors, badResponses };
}
async function menu(page, name) { await page.getByRole('button', { name: `More actions for ${name}`, exact: true }).click(); }
async function close(page) { await dialog(page).getByRole('button', { name: 'Close dialog' }).click(); }

export async function interactions(browser) {
  await mkdir(evidence, { recursive: true });
  for (const theme of ['light', 'dark']) {
    const { context, state, page, failures, consoleErrors, badResponses } = await setup(browser, theme);
    try {
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      await page.getByRole('button', { name: /Switch to .* mode/ }).focus(); await page.keyboard.press('Enter');
      const opposite = theme === 'dark' ? 'light' : 'dark';
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), opposite);
      await page.reload(); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), opposite);
      await page.getByRole('button', { name: /Switch to .* mode/ }).click(); await page.reload();
      assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), theme);
      if (theme === 'dark') assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(0, 0, 0)');
      check(theme, '1–2 theme keyboard toggle, system default, persistence, color-scheme');

      await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('test-staging');
      await page.getByRole('heading', { name: 'No endpoints yet' }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Team', exact: true }).count(), 0);
      assert(state.calls.some(c => c.path === '/api/endpoints' && c.workspace === 'test-staging'));
      await page.getByRole('combobox', { name: 'Workspace', exact: true }).selectOption('test-production');
      await page.getByRole('article', { name: 'API gateway', exact: true }).waitFor();
      check(theme, '5 workspace switch, X-Workspace-ID, owner/member Team visibility');

      const add = page.getByRole('button', { name: 'Add endpoint', exact: true }); await add.click();
      assert.equal(await dialog(page).getByRole('textbox', { name: 'Name', exact: true }).inputValue(), '');
      await dialog(page).getByRole('button', { name: 'Add Endpoint', exact: true }).click();
      await dialog(page).getByRole('alert').waitFor(); assert.equal(await page.locator('input[name="name"]').getAttribute('aria-invalid'), 'true');
      await dialog(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Test monitor');
      await dialog(page).getByRole('textbox', { name: 'URL', exact: true }).fill('ftp://invalid.example.test');
      await dialog(page).getByRole('button', { name: 'Add Endpoint', exact: true }).click();
      assert.equal(await page.locator('input[name="url"]').getAttribute('aria-invalid'), 'true');
      await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
      assert.equal(await add.evaluate(element => document.activeElement === element), true);
      await add.click(); await close(page); await add.click();
      await dialog(page).getByRole('textbox', { name: 'Name', exact: true }).fill('Test monitor');
      await dialog(page).getByRole('textbox', { name: 'URL', exact: true }).fill('https://local.example.test/health');
      state.delay = 250;
      await dialog(page).getByRole('button', { name: 'Add Endpoint', exact: true }).click();
      await page.getByRole('button', { name: 'Saving…' }).waitFor(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 1);
      await page.getByRole('article', { name: 'Test monitor', exact: true }).waitFor(); state.delay = 30;
      assert.equal(state.calls.filter(c => c.path === '/api/endpoints' && c.method === 'POST').length, 1);
      check(theme, '6–9 Add open, required/URL validation, close, isolated submit, busy guard');

      await menu(page, 'API gateway'); await page.getByRole('menuitem', { name: 'Edit endpoint' }).click();
      assert.equal(await dialog(page).getByRole('textbox', { name: 'Name', exact: true }).inputValue(), 'API gateway');
      await dialog(page).getByRole('spinbutton', { name: 'Expected status' }).fill('999');
      await dialog(page).getByRole('button', { name: 'Save Changes' }).click(); await dialog(page).getByRole('alert').waitFor();
      await dialog(page).getByRole('spinbutton', { name: 'Expected status' }).fill('200');
      await dialog(page).getByRole('button', { name: 'Save Changes' }).click(); await page.getByText('Endpoint updated.', { exact: true }).waitFor();
      await menu(page, 'API gateway'); await page.getByRole('menuitem', { name: 'Edit endpoint' }).click(); await close(page);
      check(theme, '10–13 Edit opens with values, validates, saves, closes');

      const row = page.getByRole('article', { name: 'API gateway', exact: true });
      await row.getByRole('button', { name: 'Check now' }).click(); await page.getByText('API gateway check completed.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Check all', exact: true }).click(); await page.getByRole('button', { name: 'Check all', exact: true }).waitFor();
      assert(state.calls.filter(c => c.path.endsWith('/check')).length >= 5);
      await menu(page, 'API gateway'); await page.getByRole('menuitem', { name: 'Pause monitoring' }).click(); await row.getByText('Paused', { exact: true }).first().waitFor();
      assert(await row.getByRole('button', { name: 'Check now' }).isDisabled());
      await menu(page, 'API gateway'); await page.getByRole('menuitem', { name: 'Resume monitoring' }).click(); await row.getByText('Healthy', { exact: true }).waitFor();
      await row.getByRole('button', { name: 'History' }).click(); await dialog(page).getByRole('heading', { name: 'Recent results' }).waitFor(); await dialog(page).locator('.es-history__item').first().waitFor(); await close(page);
      const link = row.getByRole('link'); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(await link.getAttribute('target'), '_blank'); assert((await link.getAttribute('aria-label')).includes('https://'));
      assert.equal(await row.locator('.es-endpoint-icon__fallback').textContent(), 'A');
      await row.getByRole('button', { name: 'More actions for API gateway' }).focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Pause monitoring'); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menu').count(), 0);
      check(theme, '14–21 Check now/all, pause/resume, history, safe URLs/fallback, keyboard menu');

      await menu(page, 'Test monitor'); await page.getByRole('menuitem', { name: 'Delete endpoint' }).click(); await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      assert(await page.getByRole('article', { name: 'Test monitor', exact: true }).isVisible());
      await menu(page, 'Test monitor'); await page.getByRole('menuitem', { name: 'Delete endpoint' }).click(); await dialog(page).getByRole('button', { name: 'Delete Endpoint' }).click();
      await page.getByRole('article', { name: 'Test monitor', exact: true }).waitFor({ state: 'detached' });
      check(theme, '22–24 themed delete confirmation, cancel and isolated deletion');

      await page.getByRole('button', { name: 'View active critical incident for Payments service' }).click();
      await dialog(page).getByRole('heading', { name: 'Incident — Payments service' }).waitFor();
      await dialog(page).getByRole('heading', { name: 'Event timeline' }).waitFor(); assert.equal(await dialog(page).locator('.es-alert-list li').count(), 3);
      await dialog(page).getByRole('button', { name: 'Acknowledge', exact: true }).click(); await dialog(page).getByText('Incident acknowledged manually.', { exact: true }).waitFor();
      await dialog(page).getByRole('button', { name: 'Resolve incident', exact: true }).click(); await dialog(page).getByText('Resolved manually', { exact: true }).waitFor(); await close(page);
      await page.getByRole('article', { name: 'Incident for API gateway', exact: true }).getByRole('button', { name: 'View incident' }).click();
      await dialog(page).getByText('Recovered automatically', { exact: true }).waitFor(); await close(page);
      await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('RESOLVED');
      await page.getByRole('article', { name: 'Incident for Payments service', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('DEGRADED'); await page.getByRole('heading', { name: 'No matching incidents' }).waitFor();
      await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption(''); await page.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('');
      check(theme, '25–30 correct incident, timeline/delivery states, acknowledge, manual resolve, automatic recovery, filters, close');

      await page.getByRole('button', { name: 'Team', exact: true }).click(); await dialog(page).getByText('@sam-dev', { exact: true }).waitFor();
      assert(await dialog(page).getByRole('combobox', { name: 'Role for sentinel-owner' }).isDisabled());
      await dialog(page).getByRole('combobox', { name: 'Role for sam-dev' }).selectOption('OWNER'); await dialog(page).getByText('@sam-dev is now owner.', { exact: true }).waitFor();
      await dialog(page).getByRole('combobox', { name: 'Role for sam-dev' }).selectOption('MEMBER'); await dialog(page).getByText('@sam-dev is now member.', { exact: true }).waitFor();
      const member = dialog(page).getByRole('listitem').filter({ hasText: '@sam-dev' }); await member.getByRole('button', { name: 'Remove', exact: true }).click();
      await dialog(page).getByRole('button', { name: 'Cancel' }).click(); await member.getByRole('button', { name: 'Remove', exact: true }).click();
      await dialog(page).getByRole('button', { name: 'Remove member', exact: true }).click(); await page.getByText('@sam-dev was removed.', { exact: true }).waitFor();
      await dialog(page).getByRole('button', { name: 'Create invitation' }).click(); await page.getByText(/Enter a valid GitHub username/).waitFor();
      await dialog(page).getByRole('textbox', { name: 'GitHub username' }).fill('new-teammate');
      await dialog(page).getByRole('combobox', { name: 'Expires in' }).selectOption('3'); await dialog(page).getByRole('button', { name: 'Create invitation' }).click();
      await dialog(page).getByRole('textbox', { name: 'Invitation link' }).waitFor(); await dialog(page).getByRole('button', { name: 'Copy link', exact: true }).click(); await dialog(page).getByRole('button', { name: 'Copied', exact: true }).waitFor();
      assert((await page.evaluate(() => navigator.clipboard.readText())).includes('/invite/test-only-invitation'));
      await dialog(page).getByRole('listitem').filter({ hasText: '@new-teammate' }).getByRole('button', { name: 'Revoke', exact: true }).click();
      await dialog(page).getByText('Invitation for @new-teammate revoked.', { exact: true }).waitFor();
      await close(page); assert.equal(await page.getByRole('dialog').count(), 0);
      check(theme, '31–38 Team, final-owner safeguard, roles, nested removal, invitation validation/create/copy/revoke');

      await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('link', { name: 'Continue with GitHub' }).waitFor();
      assert(state.calls.some(c => c.path === '/api/auth/logout' && c.method === 'POST'));
      await page.goto(target + '/invite/test-only-invitation');
      const login = page.getByRole('link', { name: 'Continue with GitHub' });
      assert((await login.getAttribute('href')).includes('returnTo=%2Finvite%2Ftest-only-invitation'));
      await login.click(); await page.getByRole('heading', { name: 'Local OAuth handoff' }).waitFor();
      check(theme, '3–4,39–40 logout, logged-out invitation, login click and OAuth return path');
      state.signedIn = true;
      await page.goto(target + '/invite/invalid'); await page.getByRole('alert').waitFor(); assert((await page.getByRole('alert').textContent()).includes('invalid'));
      for (const status of ['EXPIRED', 'REVOKED', 'ACCEPTED']) { state.invitationStatus = status; await page.goto(target + '/invite/test-only-invitation'); await page.getByText(status === 'ACCEPTED' ? 'This invitation has already been accepted.' : new RegExp(`invitation is ${status.toLowerCase()}`)).waitFor(); }
      state.invitationStatus = 'PENDING'; state.mismatch = true; await page.reload(); await page.getByText(/another-account/).waitFor(); assert.equal(await page.getByRole('button', { name: 'Accept invitation' }).count(), 0);
      state.mismatch = false; await page.reload(); await page.getByRole('button', { name: 'Accept invitation' }).click(); await page.getByRole('heading', { name: 'Operations overview' }).waitFor();
      assert.equal(await page.getByRole('combobox', { name: 'Workspace', exact: true }).inputValue(), 'test-production');
      check(theme, '41–45 invalid/expired/revoked/mismatch/accepted and successful invitation acceptance');

      await reset(page, state); state.sessionDelay = 3000; await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('Checking your secure session…').waitFor(); await page.getByRole('heading', { name: 'Operations overview' }).waitFor(); state.sessionDelay = 0;
      state.empty = true; await page.reload(); await page.getByRole('heading', { name: 'No endpoints yet' }).waitFor(); await page.getByRole('heading', { name: 'No active incidents', exact: true }).waitFor();
      state.empty = false; state.fail = '/api/endpoints'; await page.reload(); await page.getByRole('alert').waitFor(); state.fail = ''; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('article', { name: 'API gateway', exact: true }).waitFor();
      state.fail = '/api/endpoints'; state.failStatus = 403; await page.reload(); assert.match(await page.getByRole('alert').textContent(), /do not have access/i); state.fail = ''; state.failStatus = 503; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('article', { name: 'API gateway', exact: true }).waitFor();
      state.fail = '/api/incidents/incident-payments'; await page.getByRole('button', { name: 'View active critical incident for Payments service' }).click(); await dialog(page).getByRole('button', { name: 'Retry details' }).waitFor(); state.fail = ''; await dialog(page).getByRole('button', { name: 'Retry details' }).click(); await dialog(page).getByRole('heading', { name: 'Event timeline' }).waitFor(); await close(page);
      check(theme, '46–48 loading, empty, API failure and retry (including incident details)');

      await page.getByRole('link', { name: 'Overview', exact: true }).click(); await page.getByRole('button', { name: 'Add endpoint', exact: true }).click();
      for (let i = 0; i < 15; i++) { await page.keyboard.press('Tab'); assert(await dialog(page).evaluate(el => el.contains(document.activeElement))); }
      await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Add endpoint', exact: true }).click(); await page.mouse.click(5, 5); assert.equal(await page.getByRole('dialog').count(), 0);
      const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      assert.deepEqual(accessibility.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), []);
      assert.deepEqual(failures, []); assert.deepEqual(badResponses, []);
      const unexpectedConsole = consoleErrors.filter(text => !/Failed to load resource: the server responded with a status of (401|403|404|409|503)/.test(text));
      assert.deepEqual(unexpectedConsole, []);
      check(theme, '49–52 focus containment/return, Escape/backdrop, axe, zero unexpected console/resource failures');
    } finally { await context.close(); await writeFile(join(evidence, 'interaction-results.json'), JSON.stringify(results, null, 2)); }
  }
  return results;
}

export async function captures(browser) {
  await mkdir(evidence, { recursive: true });
  const records = [];
  for (const theme of ['light', 'dark']) for (const [width, height] of [[1920,1080],[1440,900],[1280,800]]) {
    const { context, page, state, failures, badResponses } = await setup(browser, theme, { width, height });
    async function capture(name) {
      await page.waitForTimeout(180);
      const fit = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, dialogs: [...document.querySelectorAll('dialog[open]')].map(el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,right:r.right,bottom:r.bottom,fits:r.x>=0 && r.y>=0 && r.right<=innerWidth && r.bottom<=innerHeight }; }) }));
      assert.equal(fit.overflow, false, `${name}: page overflows`); assert(fit.dialogs.every(d => d.fits), `${name}: dialog clipped`);
      const filename = `${theme}-${width}x${height}-${name}.png`; await page.screenshot({ path: join(evidence, filename), scale: 'css' });
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const violations = axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }));
      records.push({ theme, width, height, name, filename, fit, violations });
      await writeFile(join(evidence, 'visual-results.json'), JSON.stringify(records, null, 2));
      console.log(`CAPTURE ${filename}${violations.length ? ' AXE: '+JSON.stringify(violations) : ' axe clean'}`);
      assert.deepEqual(violations, [], `${name}: accessibility violations`);
    }
    try {
      await capture('dashboard');
      await page.getByRole('button', { name: 'Add endpoint', exact: true }).click(); await capture('endpoint-form'); await close(page);
      await menu(page, 'API gateway'); await capture('action-menu'); await page.keyboard.press('Escape');
      await page.getByRole('article', { name: 'API gateway', exact: true }).getByRole('button', { name: 'History' }).click(); await dialog(page).locator('.es-history__item').first().waitFor(); await capture('history'); await close(page);
      await menu(page, 'API gateway'); await page.getByRole('menuitem', { name: 'Delete endpoint' }).click(); await capture('confirmation'); await close(page);
      await page.getByRole('link', { name: 'Incidents', exact: true }).click(); await capture('incidents');
      await page.getByRole('button', { name: 'View incident' }).first().click(); await dialog(page).getByRole('heading', { name: 'Event timeline' }).waitFor(); await capture('incident-detail'); await close(page);
      await page.getByRole('button', { name: 'Team', exact: true }).click(); await dialog(page).getByText('@sam-dev', { exact: true }).waitFor(); await capture('team');
      await dialog(page).getByRole('listitem').filter({ hasText: '@sam-dev' }).getByRole('button', { name: 'Remove', exact: true }).click(); await capture('member-confirmation'); await dialog(page).getByRole('button', { name: 'Cancel' }).click(); await close(page);
      await page.goto(target + '/invite/test-only-invitation'); await page.getByRole('button', { name: 'Accept invitation' }).waitFor(); await capture('invitation');
      state.signedIn = false; await page.goto(target); await page.getByRole('link', { name: 'Continue with GitHub' }).waitFor(); await capture('login');
      state.signedIn = true; state.empty = true; await page.goto(target); await page.getByRole('heading', { name: 'No endpoints yet' }).waitFor(); await capture('empty');
      state.fail = '/api/endpoints'; await page.reload(); await page.getByRole('alert').waitFor(); await capture('error');
      assert.deepEqual(failures, []); assert.deepEqual(badResponses, []);
    } finally { await context.close(); }
  }
  return records;
}

if (process.argv[1]?.endsWith('qa.mjs')) {
  const browser = await chromium.launch({ channel: process.env.SENTINEL_BROWSER || 'msedge', headless: true });
  try { if (process.argv.includes('--captures')) await captures(browser); else await interactions(browser); }
  finally { await browser.close(); }
}
