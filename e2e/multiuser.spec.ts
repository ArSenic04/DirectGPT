/**
 * Any number of collaborators: four users (A, B and two extra editors C, D)
 * in four isolated browser contexts share one study room, plus a five-user
 * Sandbox session without roles.
 */
import { expect, test } from '@playwright/test';
import { findTask } from '../shared/tasks';
import { mockTransform } from '../shared/mockLLM';
import { clickAfter, editorText, expectNoErrors, openUser, selectText, uniqueSession, type User } from './helpers';

const T1 = findTask('T1')!;
const item = (id: string) => T1.items.find((i) => i.id === id)!;

let users: User[] = [];
test.afterEach(async () => {
  for (const u of users) await u.context.close();
  users = [];
});

test('four collaborators: presence, live sync, an AI edit by user C, attribution, and a conflict between C and D', async ({ browser }) => {
  test.setTimeout(90_000);
  const session = uniqueSession('quad');
  const base = { session, task: 'T1', condition: 'direct' as const };
  const alice = await openUser(browser, { ...base, pid: 'P01', name: 'Alice', role: 'A' });
  const bob = await openUser(browser, { ...base, pid: 'P02', name: 'Bob', role: 'B' });
  const carol = await openUser(browser, { ...base, pid: 'P03', name: 'Carol', role: 'C' });
  const dan = await openUser(browser, { ...base, pid: 'P04', name: 'Dan', role: 'D' });
  users = [alice, bob, carol, dan];

  // Presence: everyone sees all four people, each with a distinct colour.
  for (const u of users) {
    await expect(u.page.getByTestId('presence-user')).toHaveCount(4);
    for (const n of ['Alice', 'Bob', 'Carol', 'Dan']) await expect(u.page.getByTestId('presence')).toContainText(n);
  }
  const colors = await alice.page.locator('[data-testid="presence-user"] .cdg-avatar').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(colors).size).toBe(4);

  // Roles: A/B keep their pair items, extra editors see everyone's items.
  await expect(alice.page.getByTestId('my-items').locator('li')).toHaveCount(3);
  await expect(carol.page.getByTestId('my-role')).toContainText('Extra editor (C)');
  await expect(carol.page.getByTestId('my-items')).toHaveCount(0);
  await expect(carol.page.getByTestId('items-A').locator('li')).toHaveCount(3);
  await expect(carol.page.getByTestId('items-B').locator('li')).toHaveCount(3);

  await bob.page.getByTestId('start-task').click();
  for (const u of users) await expect(u.page.getByTestId('task-timer')).toBeVisible();

  // Live sync of manual typing from user D to everyone.
  await clickAfter(dan.page, 'Thank you to everyone who helped clear the paths last month.');
  await dan.page.keyboard.type(' See you soon!');
  for (const u of users) await expect.poll(() => editorText(u.page)).toContain('last month. See you soon!');

  // User C requests an AI edit; the others see it pending with C's name; C accepts; it syncs to all.
  const sentence = item('T1-B2').target;
  await selectText(carol.page, sentence);
  await carol.page.getByTestId('cmd-expand').click();
  const cardC = carol.page.locator('[data-testid="preview-card"][data-status="pending"]');
  await expect(cardC).toBeVisible();
  for (const u of [alice, bob, dan]) {
    const card = u.page.locator('[data-testid="preview-card"][data-status="pending"]');
    await expect(card).toContainText('Carol');
    await expect(card.getByTestId('accept')).toHaveCount(0);
  }
  await cardC.getByTestId('accept').click();
  const expanded = mockTransform('expand', '', sentence, 0);
  for (const u of users) await expect.poll(() => editorText(u.page)).toContain(expanded);
  const texts = await Promise.all(users.map((u) => editorText(u.page)));
  for (const t of texts) expect(t).toBe(texts[0]);

  // Attribution in everyone's history.
  for (const u of [alice, bob, dan]) {
    await u.page.getByTestId('tab-history').click();
    const entry = u.page.getByTestId('history-item').first();
    await expect(entry).toHaveAttribute('data-status', 'accepted');
    await expect(entry).toContainText('Carol');
    await expect(entry).toContainText('accepted by Carol');
    await u.page.getByTestId('tab-edit').click();
  }

  // Conflict between the two extra editors: C asks about paragraph 3, D edits inside it.
  const paragraph = item('T1-A2').target;
  await selectText(carol.page, paragraph);
  await carol.page.getByTestId('cmd-grammar').click();
  const conflictCard = carol.page.locator('[data-testid="preview-card"]').first();
  await expect(conflictCard).toHaveAttribute('data-status', 'pending');
  await selectText(dan.page, 'Lunch will be provided');
  await expect(dan.page.getByTestId('overlap-warning')).toContainText('Carol');
  await clickAfter(dan.page, 'Lunch will be provided');
  await dan.page.keyboard.type(' for free');
  await expect(conflictCard).toHaveAttribute('data-status', 'conflicted');
  await expect(conflictCard.getByTestId('conflict-banner')).toContainText('changed by a collaborator');
  for (const u of [alice, bob, dan]) await expect(u.page.locator('[data-testid="preview-card"]').first()).toHaveAttribute('data-status', 'conflicted');
  // Resolve on the current text: D's words survive for everyone.
  await conflictCard.getByTestId('regenerate-current').click();
  await expect(conflictCard).toHaveAttribute('data-status', 'pending');
  await conflictCard.getByTestId('accept').click();
  for (const u of users) {
    await expect.poll(() => editorText(u.page)).toContain("We don't have a lot of tools");
    expect(await editorText(u.page)).toContain('for free');
  }

  // Export covers all four participants and their roles.
  const exp = await (await alice.page.request.get(`/api/rooms/${session}.T1.direct/export`)).json();
  expect(exp.roster.map((r: { participantId: string }) => r.participantId)).toEqual(['P01', 'P02', 'P03', 'P04']);
  expect(exp.summary.participantCount).toBe(4);
  const byPid = Object.fromEntries(exp.summary.participants.map((p: { participantId: string }) => [p.participantId, p]));
  expect(byPid.P03.role).toBe('C');
  expect(byPid.P03.accepts).toBe(2);
  expect(byPid.P04.role).toBe('D');
  expect(byPid.P04.manualEditChars).toBeGreaterThan(0);
  expect(exp.summary.conflicts).toBe(1);
  const summaryCsv = await (await alice.page.request.get(`/api/rooms/${session}.T1.direct/export?format=summary.csv`)).text();
  expect(summaryCsv.trim().split('\n')).toHaveLength(5);
  expectNoErrors(...users);
});

test('five people in a Sandbox session without roles, and the invite link gives each joiner their own name and id', async ({ browser }) => {
  test.setTimeout(90_000);
  const session = uniqueSession('five');
  const names = ['Ana', 'Ben', 'Chen', 'Dev', 'Eli'];
  for (let i = 0; i < names.length; i++) {
    users.push(await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: `S${i + 1}`, name: names[i] }));
  }
  for (const u of users) await expect(u.page.getByTestId('presence-user')).toHaveCount(5);
  await expect(users[0].page.getByTestId('presence-count')).toHaveText('5 online');
  await expect(users[0].page.getByTestId('my-role')).toHaveCount(0);
  const colors = await users[0].page.locator('[data-testid="presence-user"] .cdg-avatar').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(colors).size).toBe(5);

  // The fifth user's AI edit reaches everyone.
  const eli = users[4];
  const sentence = 'Every AI edit is attributed to the person who requested it.';
  await selectText(eli.page, sentence);
  await eli.page.getByTestId('cmd-shorten').click();
  await eli.page.locator('[data-testid="preview-card"][data-status="pending"]').getByTestId('accept').click();
  const shortened = mockTransform('shorten', '', sentence, 0);
  for (const u of users) await expect.poll(() => editorText(u.page)).toContain(shortened);

  // A sixth person joins through the shared invite link: lands on setup with the session filled in and a fresh id.
  const setupCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const setup = await setupCtx.newPage();
  const errors: string[] = [];
  setup.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await setup.goto(`/#/collab?session=${session}&task=Sandbox&condition=direct&provider=mock`);
  await expect(setup.getByTestId('setup')).toBeVisible();
  await expect(setup.getByTestId('setup-session')).toHaveValue(session);
  await expect(setup.getByTestId('setup-task')).toHaveValue('sandbox');
  await expect(setup.getByTestId('setup-role')).toBeDisabled();
  const pid = await setup.getByTestId('setup-pid').inputValue();
  expect(pid).toMatch(/^u-[a-z0-9]+$/);
  const invite = await setup.getByTestId('invite-link').textContent();
  expect(invite).toContain(`session=${session}`);
  expect(invite).not.toContain('pid=');
  expect(invite).not.toContain('name=');
  await setup.getByTestId('setup-name').fill('Fay');
  await setup.getByTestId('setup-join').click();
  await expect(setup.getByTestId('workspace')).toBeVisible();
  for (const u of users) await expect(u.page.getByTestId('presence-user')).toHaveCount(6);
  expect(await editorText(setup)).toContain(shortened);

  // Study tasks: the role field offers A/B (pair) and C+ (extra editors); A gets a partner-B link.
  await setup.goto('/#/collab?session=pair05&task=T1&condition=direct');
  await expect(setup.getByTestId('setup-role')).toBeEnabled();
  await setup.getByTestId('setup-role').selectOption('A');
  await expect(setup.getByTestId('copy-pair-link')).toContainText('Copy partner B link');
  await setup.getByTestId('setup-role').selectOption('C');
  await expect(setup.getByTestId('copy-pair-link')).toHaveCount(0);
  await setupCtx.close();
  expect(errors).toEqual([]);
  expectNoErrors(...users);
});

test('ten people in one session stay in sync, and a reused participant id is flagged', async ({ browser }) => {
  test.setTimeout(120_000);
  const session = uniqueSession('ten');
  for (let i = 0; i < 10; i++) {
    users.push(await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: `T${i + 1}`, name: `User${i + 1}` }));
  }
  for (const u of users) await expect(u.page.getByTestId('presence-user')).toHaveCount(10);
  const colors = await users[9].page.locator('[data-testid="presence-user"] .cdg-avatar').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  expect(new Set(colors).size).toBe(10);
  // Every user types one word; everyone ends with the same text containing all ten.
  for (let i = 0; i < users.length; i++) {
    await clickAfter(users[i].page, 'by accident.');
    await users[i].page.keyboard.type(` w${i + 1}`);
  }
  for (const u of users) for (let i = 1; i <= 10; i++) await expect.poll(() => editorText(u.page)).toContain(` w${i}`);
  const texts = await Promise.all(users.map((u) => editorText(u.page)));
  for (const t of texts) expect(t).toBe(texts[0]);
  // Someone joins with an id already in use: both see a warning.
  const dup = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'T1', name: 'Impostor' });
  users.push(dup);
  await expect(dup.page.getByTestId('duplicate-pid')).toBeVisible();
  await expect(users[0].page.getByTestId('duplicate-pid')).toBeVisible();
  await expect(users[1].page.getByTestId('duplicate-pid')).toHaveCount(0);
  expectNoErrors(...users);
});
