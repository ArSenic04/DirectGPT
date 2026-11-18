/**
 * Generates the screenshots in docs/screenshots (run: npm run screenshots).
 * Skipped in the normal test run.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findTask } from '../shared/tasks';
import { clickAfter, expectNoErrors, openUser, selectText, uniqueSession, type User } from './helpers';

const OUT = path.resolve('docs/screenshots');
const T1 = findTask('T1')!;
const target = (id: string) => T1.items.find((i) => i.id === id)!.target;

test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 (npm run screenshots)');

let users: User[] = [];
test.afterEach(async () => {
  for (const u of users) await u.context.close();
  users = [];
});

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, name) });
}

/** Two users' screens side by side in one image. */
async function sideBySide(page: Page, left: Buffer, right: Buffer, name: string, captions: [string, string]) {
  const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  await page.setViewportSize({ width: 2900, height: 960 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1f2937;font-family:system-ui">
    <div style="display:flex;gap:20px;padding:20px">
      <figure style="margin:0"><figcaption style="color:#fff;font-size:22px;margin-bottom:8px">${captions[0]}</figcaption><img src="${img(left)}" style="width:1420px;border-radius:8px"></figure>
      <figure style="margin:0"><figcaption style="color:#fff;font-size:22px;margin-bottom:8px">${captions[1]}</figcaption><img src="${img(right)}" style="width:1420px;border-radius:8px"></figure>
    </div></body></html>`);
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

test('capture documentation screenshots', async ({ browser }) => {
  test.setTimeout(120_000);
  const session = uniqueSession('demo');
  const alice = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P01', name: 'Alice', role: 'A' });
  const bob = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P02', name: 'Bob', role: 'B' });
  users = [alice, bob];
  for (const u of users) await u.page.setViewportSize({ width: 1440, height: 900 });

  // Setup screen
  const setup = await alice.context.newPage();
  await setup.setViewportSize({ width: 1440, height: 900 });
  await setup.goto('/#/collab?session=pair01');
  await expect(setup.getByTestId('counterbalance')).toBeVisible();
  await shot(setup, '00-setup.png');
  await setup.close();

  await alice.page.getByTestId('start-task').click();
  // History material: one accepted, one rejected edit.
  await selectText(alice.page, target('T1-A3'));
  await alice.page.getByTestId('cmd-tone-formal').click();
  await alice.page.locator('[data-status="pending"]').getByTestId('accept').click();
  await selectText(bob.page, target('T1-B1'));
  await bob.page.getByTestId('cmd-summarize').click();
  await bob.page.locator('[data-testid="preview-card"][data-status="pending"]').getByTestId('accept').click();
  await selectText(bob.page, target('T1-B2'));
  await bob.page.getByTestId('cmd-expand').click();
  await bob.page.locator('[data-testid="preview-card"][data-status="pending"]').getByTestId('reject').click();

  // Alice: pending shorten request with preview; Bob selects something else.
  await selectText(alice.page, target('T1-A1'));
  await alice.page.getByTestId('cmd-shorten').click();
  await expect(alice.page.locator('[data-testid="preview-card"][data-status="pending"]')).toBeVisible();
  await bob.page.bringToFront();
  await selectText(bob.page, 'Lunch will be provided by the Rossi family.');
  await alice.page.bringToFront();
  await alice.page.mouse.move(5, 5);
  await shot(alice.page, '02-preview.png');
  const left = await alice.page.screenshot();
  const right = await bob.page.screenshot();

  // History panel
  await bob.page.getByTestId('tab-history').click();
  await bob.page.getByTestId('history-item').nth(1).locator('.cdg-history-summary').click();
  await shot(bob.page, '03-history.png');
  await bob.page.getByTestId('tab-edit').click();

  // Conflict: Bob edits inside Alice's pending sentence.
  await clickAfter(bob.page, 'comparing options');
  await bob.page.keyboard.type(' carefully');
  await expect(alice.page.locator('[data-testid="preview-card"][data-status="conflicted"]')).toBeVisible();
  await alice.page.getByTestId('apply-anyway').scrollIntoViewIfNeeded();
  await shot(alice.page, '04-conflict.png');

  // Baseline condition
  const session2 = uniqueSession('demob');
  const carol = await openUser(browser, { session: session2, task: 'T2', condition: 'baseline', pid: 'P03', name: 'Carol', role: 'A' });
  const dan = await openUser(browser, { session: session2, task: 'T2', condition: 'baseline', pid: 'P04', name: 'Dan', role: 'B' });
  users.push(carol, dan);
  await carol.page.setViewportSize({ width: 1440, height: 900 });
  await carol.page.getByTestId('start-task').click();
  await carol.page.getByTestId('chat-input').fill('Shorten "Planning the makerspace took almost two years."');
  await carol.page.getByTestId('chat-send').click();
  await carol.page.getByTestId('chat-input').fill('Make the second paragraph more formal');
  await expect(carol.page.getByTestId('chat-assistant')).toHaveCount(1);
  await carol.page.getByTestId('chat-send').click();
  await expect(carol.page.getByTestId('chat-assistant')).toHaveCount(2);
  await shot(carol.page, '05-baseline.png');

  // Questionnaire
  await carol.page.getByTestId('finish-task').click();
  const q = carol.page.getByTestId('questionnaire');
  await expect(q).toBeVisible();
  for (const row of (await q.locator('[data-testid^="likert-"]').all()).slice(0, 4)) await row.locator('input[type=radio]').nth(4).check();
  await shot(carol.page, '06-questionnaire.png');

  // Two users side by side (rendered last because it reuses a page)
  const canvas = await alice.context.newPage();
  await sideBySide(canvas, left, right, '01-two-users.png', ['Alice (partner A): reviewing her AI suggestion', 'Bob (partner B): sees Alice\'s pending request live']);
  await canvas.close();
  expectNoErrors(alice, bob, carol, dan);
});

/** Four screens in a 2 x 2 grid. */
async function grid(page: Page, shots: Buffer[], captions: string[], name: string) {
  const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  await page.setViewportSize({ width: 2900, height: 1900 });
  const cell = (i: number) =>
    `<figure style="margin:0"><figcaption style="color:#fff;font-size:22px;margin-bottom:8px">${captions[i]}</figcaption><img src="${img(shots[i])}" style="width:1420px;border-radius:8px"></figure>`;
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#1f2937;font-family:system-ui">
    <div style="display:grid;grid-template-columns:1420px 1420px;gap:20px;padding:20px">${[0, 1, 2, 3].map(cell).join('')}</div></body></html>`);
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

test('capture multi-user screenshot', async ({ browser }) => {
  test.setTimeout(120_000);
  const session = uniqueSession('team');
  const base = { session, task: 'T1', condition: 'direct' as const };
  const people = [
    await openUser(browser, { ...base, pid: 'P01', name: 'Alice', role: 'A' }),
    await openUser(browser, { ...base, pid: 'P02', name: 'Bob', role: 'B' }),
    await openUser(browser, { ...base, pid: 'P03', name: 'Carol', role: 'C' }),
    await openUser(browser, { ...base, pid: 'P04', name: 'Dan', role: 'D' }),
  ];
  users = people;
  const [alice, bob, carol, dan] = people;
  for (const u of people) await u.page.setViewportSize({ width: 1440, height: 900 });
  await alice.page.getByTestId('start-task').click();
  // Dan (extra editor) shortens a sentence; it is accepted and synced.
  await selectText(dan.page, target('T1-A1'));
  await dan.page.getByTestId('cmd-shorten').click();
  await dan.page.locator('[data-testid="preview-card"][data-status="pending"]').getByTestId('accept').click();
  // Carol (extra editor) asks for a grammar fix on paragraph 3 and is reviewing it.
  await selectText(carol.page, target('T1-A2'));
  await carol.page.getByTestId('cmd-grammar').click();
  await expect(carol.page.locator('[data-testid="preview-card"][data-status="pending"]')).toBeVisible();
  // Bob types at the end of the first paragraph; Alice selects the last sentence.
  await clickAfter(bob.page, 'clear the paths last month.');
  await bob.page.keyboard.type(' Welcome, everyone!');
  await alice.page.bringToFront();
  await selectText(alice.page, target('T1-A3'));
  await bob.page.getByTestId('tab-history').click();
  for (const u of people) await expect.poll(() => u.page.getByTestId('presence-user').count()).toBe(4);
  await carol.page.waitForTimeout(400);
  const shots = [];
  for (const u of people) shots.push(await u.page.screenshot());
  const canvas = await alice.context.newPage();
  await grid(canvas, shots, [
    'Alice (partner A): selecting the last sentence',
    'Bob (partner B): typing, with the shared history open',
    'Carol (extra editor C): reviewing her AI grammar fix',
    'Dan (extra editor D): his accepted AI edit is synced to everyone',
  ], '07-four-users.png');
  await canvas.close();
  expectNoErrors(...people);
});
