/**
 * End-to-end tests: two browser contexts = two users editing one document
 * through the real server with the MOCK LLM.
 */
import { expect, test } from '@playwright/test';
import { findTask } from '../shared/tasks';
import { mockTransform } from '../shared/mockLLM';
import { clickAfter, editorText, expectNoErrors, openUser, selectText, uniqueSession, type User } from './helpers';

const T1 = findTask('T1')!;
const T2 = findTask('T2')!;
const item = (id: string) => [...T1.items, ...T2.items].find((i) => i.id === id)!;

let users: User[] = [];
test.afterEach(async () => {
  for (const u of users) await u.context.close();
  users = [];
});

test('direct manipulation: select, request, preview, accept, sync, history attribution, revert', async ({ browser }) => {
  const session = uniqueSession('direct');
  const alice = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P01', name: 'Alice', role: 'A' });
  const bob = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P02', name: 'Bob', role: 'B' });
  users = [alice, bob];

  // Shared workspace and presence (step 1)
  await expect(alice.page.getByTestId('presence')).toContainText('Bob');
  await expect(bob.page.getByTestId('presence')).toContainText('Alice');
  expect(await editorText(alice.page)).toBe(T1.text);
  expect(await editorText(bob.page)).toBe(T1.text);

  // AI is disabled until the task starts; starting is shared.
  await expect(alice.page.getByTestId('cmd-shorten')).toBeDisabled();
  await bob.page.getByTestId('start-task').click();
  await expect(alice.page.getByTestId('task-timer')).toBeVisible();

  // Direct selection defines the scope (step 2)
  const target = item('T1-A1').target;
  await selectText(alice.page, target);
  await expect(alice.page.getByTestId('selection-info')).toContainText(target.slice(0, 60));
  await expect(alice.page.getByTestId('selection-scope')).toHaveText('sentence');

  // AI editing request from the toolbar (step 3) -> LLM processing (step 4)
  await alice.page.getByTestId('cmd-shorten').click();
  const aliceCard = alice.page.getByTestId('preview-card').first();
  await expect(aliceCard).toHaveAttribute('data-status', 'generating');
  // Bob sees Alice's pending request live, on the text and in his panel.
  await expect(bob.page.locator('.cdg-mark-label').first()).toContainText('Alice · Shorten');
  await expect(bob.page.getByTestId('presence')).toContainText('waiting for the AI');

  // Preview beside the original (step 5)
  await expect(aliceCard).toHaveAttribute('data-status', 'pending');
  const expected = mockTransform('shorten', '', target, 0);
  await expect(aliceCard.getByTestId('diff-original')).toHaveText(target);
  await expect(aliceCard.getByTestId('diff-suggestion')).toHaveText(expected);
  await expect(aliceCard.locator('.cdg-mock-badge')).toBeVisible();
  const bobCard = bob.page.getByTestId('preview-card').first();
  await expect(bobCard.getByTestId('only-requester')).toContainText('Only Alice');
  await expect(bobCard.getByTestId('accept')).toHaveCount(0);

  // Approval (step 6) -> only the selected text changes and syncs (step 7)
  await aliceCard.getByTestId('accept').click();
  const afterAccept = T1.text.replace(target, expected);
  await expect.poll(() => editorText(alice.page)).toBe(afterAccept);
  await expect.poll(() => editorText(bob.page)).toBe(afterAccept);

  // Edit history and attribution (step 8)
  await bob.page.getByTestId('tab-history').click();
  const entry = bob.page.getByTestId('history-item').first();
  await expect(entry).toHaveAttribute('data-status', 'accepted');
  await expect(entry.getByTestId('history-requester')).toHaveText('Alice');
  await expect(entry).toContainText('accepted by Alice');

  // Anyone can revert an accepted AI edit; the revert is attributed.
  await entry.getByTestId('revert').click();
  await expect.poll(() => editorText(alice.page)).toBe(T1.text);
  await expect(entry).toHaveAttribute('data-status', 'reverted');
  await alice.page.getByTestId('tab-history').click();
  await expect(alice.page.getByTestId('history-item').first()).toContainText('reverted by Bob');

  // Regenerate keeps versions; reject leaves the document untouched.
  await alice.page.getByTestId('tab-edit').click();
  await selectText(alice.page, item('T1-B2').target);
  await alice.page.getByTestId('cmd-expand').click();
  const card2 = alice.page.locator('[data-testid="preview-card"][data-status="pending"]').first();
  await expect(card2.getByTestId('diff-suggestion')).toHaveText(mockTransform('expand', '', item('T1-B2').target, 0));
  await card2.getByTestId('regenerate').click();
  await expect(card2.getByTestId('version-label')).toHaveText('Version 2 of 2');
  await expect(card2.getByTestId('diff-suggestion')).toHaveText(mockTransform('expand', '', item('T1-B2').target, 1));
  await card2.getByRole('button', { name: 'Previous version' }).click();
  await expect(card2.getByTestId('version-label')).toHaveText('Version 1 of 2');
  await card2.getByTestId('reject').click();
  await expect(alice.page.getByTestId('preview-card')).toHaveCount(0);
  expect(await editorText(bob.page)).toBe(T1.text);

  // Custom typed instruction + saving it to the shared team toolbar.
  await selectText(alice.page, item('T1-A3').target);
  await alice.page.getByTestId('custom-instruction').fill('make this sound more professional');
  await alice.page.getByTestId('save-command').click();
  await bob.page.getByTestId('tab-edit').click();
  await expect(bob.page.getByTestId('saved-command')).toHaveText('make this sound more p…');
  await alice.page.getByTestId('ask-ai').click();
  const card3 = alice.page.locator('[data-testid="preview-card"][data-status="pending"]').first();
  await expect(card3.getByTestId('diff-suggestion')).toHaveText(mockTransform('custom', 'make this sound more professional', item('T1-A3').target, 0));
  await card3.getByTestId('accept').click();
  await expect.poll(() => editorText(bob.page)).toContain('inform the coordinators');

  // The shared log recorded the activity of both users.
  const exp = await (await alice.page.request.get(`/api/rooms/${session}.T1.direct/export`)).json();
  const types = exp.events.map((e: { type: string }) => e.type);
  for (const t of ['session_join', 'task_start', 'ai_request', 'ai_response', 'accept', 'revert', 'regenerate', 'reject', 'command_saved']) {
    expect(types).toContain(t);
  }
  expect(exp.summary.prompts).toBe(3);
  expect(exp.summary.accepts).toBe(2);
  const accept = exp.events.find((e: { type: string }) => e.type === 'accept');
  expect(accept.data.changedOutside).toBe(0);
  expectNoErrors(alice, bob);
});

test('conflict: a collaborator edits the selected text while a suggestion is pending', async ({ browser }) => {
  const session = uniqueSession('conflict');
  const alice = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P01', name: 'Alice', role: 'A' });
  const bob = await openUser(browser, { session, task: 'T1', condition: 'direct', pid: 'P02', name: 'Bob', role: 'B' });
  users = [alice, bob];
  await alice.page.getByTestId('start-task').click();

  const paragraph = item('T1-A2').target;
  await selectText(alice.page, paragraph);
  await expect(alice.page.getByTestId('selection-scope')).toHaveText('paragraph');
  await alice.page.getByTestId('cmd-grammar').click();
  const card = alice.page.getByTestId('preview-card').first();
  await expect(card).toHaveAttribute('data-status', 'pending');

  // Bob selects overlapping text: he is warned about Alice's pending request.
  await selectText(bob.page, 'Lunch will be provided');
  await expect(bob.page.getByTestId('overlap-warning')).toContainText('Alice');

  // Bob edits inside Alice's anchored paragraph.
  await clickAfter(bob.page, 'Lunch will be provided');
  await bob.page.keyboard.type(' for free');
  await expect.poll(() => editorText(alice.page)).toContain('Lunch will be provided for free');

  // Alice's request is flagged and cannot be applied silently.
  await expect(card).toHaveAttribute('data-status', 'conflicted');
  await expect(card.getByTestId('conflict-banner')).toContainText('changed by a collaborator');
  await expect(card.getByTestId('conflict-current')).toContainText('for free');
  await expect(card.getByTestId('accept')).toHaveCount(0);
  await expect(alice.page.locator('.cdg-mark-label-conflicted')).toBeVisible();
  await expect(bob.page.getByTestId('preview-card').first()).toHaveAttribute('data-status', 'conflicted');

  // Resolve by regenerating on the current text: Bob's words are preserved.
  await card.getByTestId('regenerate-current').click();
  await expect(card).toHaveAttribute('data-status', 'pending');
  await card.getByTestId('accept').click();
  const changed = paragraph.replace('Lunch will be provided', 'Lunch will be provided for free');
  const expected = T1.text.replace(paragraph, mockTransform('grammar', '', changed, 1));
  await expect.poll(() => editorText(bob.page)).toBe(expected);
  expect(await editorText(alice.page)).toContain("We don't have a lot of tools");
  expect(await editorText(alice.page)).toContain('for free');

  // Second conflict, resolved with an explicit "Apply anyway".
  const sentence = item('T1-B2').target;
  await selectText(alice.page, sentence);
  await alice.page.getByTestId('cmd-shorten').click();
  const card2 = alice.page.locator('[data-testid="preview-card"]').first();
  await expect(card2).toHaveAttribute('data-status', 'pending');
  await clickAfter(bob.page, 'The barrels will be installed');
  await bob.page.keyboard.type(' soon');
  await expect(card2).toHaveAttribute('data-status', 'conflicted');
  await card2.getByTestId('apply-anyway').click();
  await expect(alice.page.getByTestId('preview-card')).toHaveCount(0);
  await bob.page.getByTestId('tab-history').click();
  const latest = bob.page.getByTestId('history-item').first();
  await expect(latest).toHaveAttribute('data-status', 'accepted');
  await expect(latest).toContainText('applied over a conflict');

  const exp = await (await alice.page.request.get(`/api/rooms/${session}.T1.direct/export`)).json();
  expect(exp.summary.conflicts).toBe(2);
  expect(exp.summary.conflictOverrides).toBe(1);
  expect(exp.summary.overlapWarnings).toBe(0);
  expect(exp.events.some((e: { type: string; data: { action?: string } }) => e.type === 'conflict_resolved' && e.data.action === 'regenerate')).toBe(true);
  expectNoErrors(alice, bob);
});

test('baseline: chat-based editing with whole-document context, copy/paste, finish and questionnaire', async ({ browser }) => {
  const session = uniqueSession('baseline');
  const alice = await openUser(browser, { session, task: 'T2', condition: 'baseline', pid: 'P01', name: 'Alice', role: 'A' });
  const bob = await openUser(browser, { session, task: 'T2', condition: 'baseline', pid: 'P02', name: 'Bob', role: 'B' });
  users = [alice, bob];

  await expect(alice.page.getByTestId('condition-badge')).toHaveText('Baseline: chat');
  await expect(alice.page.getByTestId('direct-panel')).toHaveCount(0);
  await expect(alice.page.getByTestId('tab-history')).toHaveCount(0);
  await expect(alice.page.getByTestId('chat-panel')).toContainText('entire document');
  await alice.page.getByTestId('start-task').click();

  // Alice asks the chat assistant; the whole document is sent as context.
  const ask = 'Fix the grammar and spelling mistakes in paragraph 3';
  await alice.page.getByTestId('chat-input').fill(ask);
  await alice.page.getByTestId('chat-send').click();
  const answer = alice.page.getByTestId('chat-assistant').last();
  await expect(answer).toContainText('Here is the revised document:');
  await expect(answer).toContainText('Training sessions are required');
  await expect(answer.locator('.cdg-mock-badge')).toBeVisible();
  // The chat is private to Alice, like a separate ChatGPT window.
  await expect(bob.page.getByTestId('chat-user')).toHaveCount(0);

  // Copy the answer and paste it over the whole document.
  await answer.getByTestId('copy-response').click();
  await expect(answer.getByTestId('copy-response')).toHaveText('Copied ✓');
  const clip = await alice.page.evaluate(() => navigator.clipboard.readText());
  expect(clip.startsWith('The Riverside Public Library')).toBe(true);
  await alice.page.getByTestId('editor-content').click();
  await alice.page.keyboard.press('ControlOrMeta+A');
  await alice.page.keyboard.press('ControlOrMeta+V');
  await expect.poll(() => editorText(bob.page)).toContain('Training sessions are required');

  // Finish -> both partners get the questionnaire.
  await bob.page.getByTestId('finish-task').click();
  for (const u of [alice, bob]) {
    const q = u.page.getByTestId('questionnaire');
    await expect(q).toBeVisible();
    await expect(q.getByTestId('q-submit')).toBeDisabled();
    for (const row of await q.locator('[data-testid^="likert-"]').all()) await row.locator('input[type=radio]').nth(5).check();
    for (const slider of await q.locator('[data-testid^="tlx-"] input[type=range]').all()) await slider.fill('35');
    await q.getByTestId('q-comment').fill(`${u.name} comment`);
    await q.getByTestId('q-submit').click();
    await expect(u.page.getByTestId('task-done')).toBeVisible();
  }

  // Export: JSON summary + CSVs, including unintended modifications.
  const room = `${session}.T2.baseline`;
  const exp = await (await alice.page.request.get(`/api/rooms/${room}/export`)).json();
  expect(exp.summary.prompts).toBe(1);
  expect(exp.summary.copies).toBe(1);
  expect(exp.summary.pastes).toBe(1);
  expect(exp.summary.taskTimeSec).toBeGreaterThan(0);
  const paste = exp.events.find((e: { type: string }) => e.type === 'paste');
  expect(paste.data.fromAI).toBe(true);
  expect(exp.summary.intendedChangeChars).toBeGreaterThan(0);
  expect(exp.questionnaires).toHaveLength(2);
  const aliceSummary = exp.summary.participants.find((p: { participantId: string }) => p.participantId === 'P01');
  expect(aliceSummary.questionnaire).toEqual({ control: 6, transparency: 6, coordination: 6, tlxRaw: 35 });
  const summaryCsv = await (await alice.page.request.get(`/api/rooms/${room}/export?format=summary.csv`)).text();
  expect(summaryCsv.trim().split('\n')).toHaveLength(3);
  const qCsv = await (await alice.page.request.get(`/api/rooms/${room}/export?format=questionnaires.csv`)).text();
  expect(qCsv).toContain('Bob comment');

  // The export menu offers downloadable files.
  await alice.page.getByTestId('export-button').click();
  const download = alice.page.waitForEvent('download');
  await alice.page.getByTestId('export-events.csv').click();
  expect((await download).suggestedFilename()).toBe(`${room}.events.csv`);
  expectNoErrors(alice, bob);
});

test('LLM errors are reported gracefully (missing key, unreachable provider)', async ({ browser }) => {
  const session = uniqueSession('errors');
  const alice = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P01', name: 'Alice', role: 'A', provider: 'openai' });
  users = [alice];
  await expect(alice.page.getByTestId('llm-badge')).toContainText('key missing');
  await selectText(alice.page, 'Every AI edit is attributed to the person who requested it.');
  await alice.page.getByTestId('cmd-rewrite').click();
  const card = alice.page.getByTestId('preview-card').first();
  await expect(card).toHaveAttribute('data-status', 'failed');
  await expect(card.getByTestId('request-error')).toContainText('No OpenAI API key');

  // With a key, the (deliberately unreachable) provider yields a network error, not a crash.
  await alice.page.getByTestId('llm-badge').click();
  await alice.page.getByTestId('api-key').fill('sk-test-not-a-real-key');
  await card.getByTestId('retry').click();
  await expect(card.getByTestId('request-error')).toContainText('Could not reach the LLM provider');
  await expect(card).toHaveAttribute('data-status', 'failed');

  // Switching to the MOCK provider recovers.
  await alice.page.getByTestId('provider-select').selectOption('mock');
  await card.getByTestId('retry').click();
  await expect(card).toHaveAttribute('data-status', 'pending');
  await card.getByTestId('accept').click();
  await expect(alice.page.getByTestId('preview-card')).toHaveCount(0);
  // Request errors are logged as events, never as console errors.
  const exp = await (await alice.page.request.get(`/api/rooms/${session}.sandbox.direct/export`)).json();
  expect(exp.summary.aiErrors).toBe(2);
  expectNoErrors(alice);
});

test('setup screen, launcher link, and the original DirectGPT still loads', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/');
  await expect(page.getByTestId('launcher-collab')).toBeVisible();
  await expect(page.getByText('Shortcuts to try out DirectGPT on examples')).toBeVisible();
  await page.getByTestId('launcher-collab').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.getByTestId('setup-session').fill('pair02');
  await expect(page.getByTestId('counterbalance')).toContainText('Baseline (prompt-based chat) on T1');
  await page.getByTestId('setup-pid').fill('P03');
  await page.getByTestId('setup-name').fill('Carol');
  await page.getByTestId('setup-task').selectOption('sandbox');
  await page.getByTestId('setup-join').click();
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('presence')).toContainText('Carol (you)');
  await expect(page.getByTestId('llm-badge')).toContainText('MOCK');
  // Original DirectGPT text mode renders (it needs a real key only to run prompts).
  await page.goto('/#/text');
  await expect(page.getByText('Alice was beginning to get very tired', { exact: false }).first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
