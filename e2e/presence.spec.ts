/**
 * Presence must reflect who is connected to this room right now:
 * people who close, reload or leave disappear at once, and a new session
 * never shows people from an earlier one.
 */
import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, openUser, uniqueSession, type User } from './helpers';

let users: User[] = [];
test.afterEach(async () => {
  for (const u of users) await u.context.close().catch(() => undefined);
  users = [];
});

const online = (page: Page) => page.getByTestId('presence-user');
const names = (page: Page) => page.locator('[data-testid="presence-user"] .cdg-presence-name').allInnerTexts();

test('closing or reloading a window updates everyone\'s online list at once, without ghosts or duplicates', async ({ browser }) => {
  const session = uniqueSession('pres');
  const o = (pid: string, name: string) => ({ session, task: 'sandbox', condition: 'direct' as const, pid, name });
  const alice = await openUser(browser, o('P1', 'Alice'));
  const bob = await openUser(browser, o('P2', 'Bob'));
  const carol = await openUser(browser, o('P3', 'Carol'));
  users = [alice, bob, carol];
  for (const u of users) await expect(online(u.page)).toHaveCount(3);

  // Carol closes her window: the others drop to 2 within 1.5 s.
  const closedAt = Date.now();
  await carol.page.close();
  await expect(online(alice.page)).toHaveCount(2, { timeout: 1500 });
  await expect(online(bob.page)).toHaveCount(2, { timeout: 1500 });
  expect(Date.now() - closedAt).toBeLessThan(1500);
  expect((await names(alice.page)).join(' ')).not.toContain('Carol');

  // Bob reloads: never a duplicate Bob, and no "same participant id" warning.
  await bob.page.reload();
  await expect(bob.page.getByTestId('workspace')).toBeVisible();
  await expect(online(bob.page)).toHaveCount(2);
  for (let i = 0; i < 8; i++) {
    expect(await online(alice.page).count()).toBeLessThanOrEqual(2);
    await alice.page.waitForTimeout(250);
  }
  await expect(online(alice.page)).toHaveCount(2);
  await expect(alice.page.getByTestId('duplicate-pid')).toHaveCount(0);
  await expect(bob.page.getByTestId('duplicate-pid')).toHaveCount(0);

  // Closing the whole browser context (all of Bob's windows) is just as quick.
  const closedBob = Date.now();
  await bob.context.close();
  await expect(online(alice.page)).toHaveCount(1, { timeout: 1500 });
  expect(Date.now() - closedBob).toBeLessThan(1500);
  expectNoErrors(alice);
});

test('a new session only shows the people connected to it, from a fresh page or after leaving another session in the same tab', async ({ browser }) => {
  const X = uniqueSession('sx');
  const Y = uniqueSession('sy');
  const watcher = await openUser(browser, { session: X, task: 'sandbox', condition: 'direct', pid: 'W', name: 'Watcher' });
  const tab = await openUser(browser, { session: X, task: 'sandbox', condition: 'direct', pid: 'P1', name: 'Alice' });
  users = [watcher, tab];
  await expect(online(watcher.page)).toHaveCount(2);

  // Alice leaves session X from the header; she is gone from X immediately.
  await tab.page.getByTestId('leave-session').click();
  await expect(tab.page.getByTestId('setup')).toBeVisible();
  await expect(online(watcher.page)).toHaveCount(1, { timeout: 1500 });

  // A fresh page joins the new session Y as Carol: only Carol is online.
  const carol = await openUser(browser, { session: Y, task: 'sandbox', condition: 'direct', pid: 'P3', name: 'Carol' });
  users.push(carol);
  await expect(online(carol.page)).toHaveCount(1);
  expect(await names(carol.page)).toEqual(['Carol (you)']);

  // In the same tab Alice used, join Y as Bob through the setup screen.
  const setup = tab.page;
  await expect(setup.getByTestId('setup-session')).not.toHaveValue(X);
  await expect(setup.getByTestId('setup-session')).toHaveValue(/^s-[a-z0-9]+$/);
  await setup.getByTestId('setup-session').fill(Y);
  await setup.getByTestId('setup-pid').fill('P2');
  await setup.getByTestId('setup-name').fill('Bob');
  await setup.getByTestId('setup-task').selectOption('sandbox');
  await setup.getByTestId('setup-join').click();
  await expect(setup.getByTestId('workspace')).toBeVisible();
  await expect(online(setup)).toHaveCount(2);
  expect((await names(setup)).sort()).toEqual(['Bob (you)', 'Carol']);
  await expect(online(carol.page)).toHaveCount(2);
  expect((await names(carol.page)).join(' ')).not.toMatch(/Alice|Watcher/);
  // ...and session X is not affected by the tab that moved on.
  await setup.waitForTimeout(500);
  expect(await names(watcher.page)).toEqual(['Watcher (you)']);

  // Changing only the link in the address bar (no page reload) also switches rooms cleanly.
  const Z = uniqueSession('sz');
  await setup.evaluate((z) => {
    window.location.hash = `/collab?session=${z}&task=sandbox&condition=direct&pid=P2&name=Bob&provider=mock`;
  }, Z);
  await expect(setup.getByTestId('room-name')).toContainText(Z);
  await expect(online(setup)).toHaveCount(1);
  await expect(online(carol.page)).toHaveCount(1, { timeout: 1500 });
  expectNoErrors(...users);
});

test('tabs of the same browser (shared storage) also leave at once when one is closed or reloaded', async ({ browser }) => {
  const session = uniqueSession('tabs');
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const errors: string[] = [];
  const open = async (pid: string, name: string) => {
    const page = await context.newPage();
    page.on('console', (m) => m.type() === 'error' && errors.push(`[${name}] ${m.text()}`));
    page.on('pageerror', (e) => errors.push(`[${name}] ${e.message}`));
    await page.goto(`/#/collab?session=${session}&task=sandbox&condition=direct&pid=${pid}&name=${name}&provider=mock`);
    await expect(page.getByTestId('workspace')).toBeVisible();
    return page;
  };
  const a = await open('P1', 'Ann');
  const b = await open('P2', 'Ben');
  const c = await open('P3', 'Cy');
  for (const p of [a, b, c]) await expect(online(p)).toHaveCount(3);
  const t0 = Date.now();
  await c.close();
  await expect(online(a)).toHaveCount(2, { timeout: 1500 });
  await expect(online(b)).toHaveCount(2, { timeout: 1500 });
  expect(Date.now() - t0).toBeLessThan(1500);
  await b.reload();
  await expect(b.getByTestId('workspace')).toBeVisible();
  await expect(online(a)).toHaveCount(2);
  await expect(online(b)).toHaveCount(2);
  await a.waitForTimeout(1000);
  await expect(online(a)).toHaveCount(2);
  await b.close();
  await expect(online(a)).toHaveCount(1, { timeout: 1500 });
  await context.close();
  expect(errors).toEqual([]);
});
