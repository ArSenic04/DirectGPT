/**
 * Group review of AI suggestions: teammates vote and comment on a pending
 * suggestion, the requester sees the votes, and an optional shared setting
 * requires majority approval before Accept.
 */
import { expect, test } from '@playwright/test';
import { editorText, expectNoErrors, openUser, selectText, uniqueSession, type User } from './helpers';

const SENTENCE = 'Every AI edit is attributed to the person who requested it.';

let users: User[] = [];
test.afterEach(async () => {
  for (const u of users) await u.context.close();
  users = [];
});

async function ask(user: User, command = 'cmd-shorten') {
  await selectText(user.page, SENTENCE);
  await user.page.getByTestId(command).click();
  const card = user.page.locator('[data-testid="preview-card"][data-status="pending"]').first();
  await expect(card).toBeVisible();
  return card;
}

test('teammates vote and comment, everyone sees who voted, and the vote is saved in history', async ({ browser }) => {
  const session = uniqueSession('review');
  const alice = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P01', name: 'Alice' });
  const bob = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P02', name: 'Bob' });
  const carol = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P03', name: 'Carol' });
  users = [alice, bob, carol];

  const aliceCard = await ask(alice);
  const bobCard = bob.page.getByTestId('preview-card').first();
  const carolCard = carol.page.getByTestId('preview-card').first();
  await expect(bobCard.getByTestId('review-box')).toBeVisible();

  // The requester sees the group's reaction but cannot vote on her own suggestion.
  await expect(aliceCard.getByTestId('vote-up')).toBeDisabled();
  await bobCard.getByTestId('vote-up').click();
  await expect(aliceCard.getByTestId('votes-up')).toHaveText('1');
  await expect(aliceCard.getByTestId('voters-up')).toContainText('Bob');
  await expect(carolCard.getByTestId('voters-up')).toContainText('Bob');
  await expect(bobCard.getByTestId('vote-up')).toHaveAttribute('aria-pressed', 'true');

  await carolCard.getByTestId('vote-down').click();
  await carolCard.getByTestId('comment-input').fill('Keep the word "attributed".');
  await carolCard.getByTestId('comment-send').click();
  await expect(aliceCard.getByTestId('votes-down')).toHaveText('1');
  await expect(aliceCard.getByTestId('voters-down')).toContainText('Carol');
  await expect(aliceCard.getByTestId('comment')).toContainText('Carol');
  await expect(aliceCard.getByTestId('comment')).toContainText('Keep the word');
  await expect(bobCard.getByTestId('comment')).toHaveCount(1);

  // Voting again takes it back; changing sides moves the vote.
  await bobCard.getByTestId('vote-up').click();
  await expect(aliceCard.getByTestId('votes-up')).toHaveText('0');
  await bobCard.getByTestId('vote-down').click();
  await expect(aliceCard.getByTestId('votes-down')).toHaveText('2');

  // Without the setting, Alice can still decide alone (accept behaviour unchanged).
  await expect(aliceCard.getByTestId('accept')).toBeEnabled();
  await aliceCard.getByTestId('accept').click();
  await expect.poll(() => editorText(bob.page)).not.toContain(SENTENCE);

  // Votes and comments are kept in history.
  await bob.page.getByTestId('tab-history').click();
  const item = bob.page.getByTestId('history-item').first();
  await expect(item).toHaveAttribute('data-status', 'accepted');
  await expect(item.getByTestId('history-review-summary')).toContainText('👎 2');
  await expect(item.getByTestId('history-review-summary')).toContainText('1 comment');
  await item.locator('.cdg-history-summary').click();
  await expect(item.getByTestId('history-review')).toContainText('Carol');
  await expect(item.getByTestId('history-review')).toContainText('Keep the word');

  const exp = await (await alice.page.request.get(`/api/rooms/${session}.sandbox.direct/export`)).json();
  expect(exp.reviews.map((r: { kind: string }) => r.kind).sort()).toEqual(['comment', 'vote', 'vote', 'vote', 'vote']);
  const types = exp.events.map((e: { type: string }) => e.type);
  expect(types).toContain('review_vote');
  expect(types).toContain('review_comment');
  const accept = exp.events.find((e: { type: string }) => e.type === 'accept');
  expect(accept.data.votesDown).toBe(2);
  expect(accept.data.comments).toBe(1);
  expectNoErrors(alice, bob, carol);
});

test('require majority approval: Accept waits for the group, and is waived when alone', async ({ browser }) => {
  const session = uniqueSession('approval');
  const alice = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P01', name: 'Alice' });

  // Alone in the room: the requirement cannot block anyone.
  await alice.page.getByTestId('require-approval').check();
  const solo = await ask(alice);
  await expect(solo.getByTestId('approval-status')).toContainText('nobody else is online');
  await expect(solo.getByTestId('accept')).toBeEnabled();
  await solo.getByTestId('reject').click();

  const bob = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P02', name: 'Bob' });
  const carol = await openUser(browser, { session, task: 'sandbox', condition: 'direct', pid: 'P03', name: 'Carol' });
  users = [alice, bob, carol];
  // The setting is shared by the whole session.
  await expect(bob.page.getByTestId('require-approval')).toBeChecked();
  await expect(alice.page.getByTestId('presence-user')).toHaveCount(3);

  const card = await ask(alice);
  const accept = card.getByTestId('accept');
  await expect(card.getByTestId('approval-status')).toContainText('0 of 2 thumbs-up needed');
  await expect(accept).toBeDisabled();
  await expect(card.getByTestId('reject')).toBeEnabled();

  const bobCard = bob.page.getByTestId('preview-card').first();
  const carolCard = carol.page.getByTestId('preview-card').first();
  await bobCard.getByTestId('vote-up').click();
  await expect(card.getByTestId('approval-status')).toContainText('1 of 2');
  await expect(accept).toBeDisabled();
  await carolCard.getByTestId('vote-up').click();
  await expect(card.getByTestId('approval-status')).toContainText('Approved by the group');
  await expect(accept).toBeEnabled();

  // A teammate changing their mind takes the approval away again.
  await carolCard.getByTestId('vote-down').click();
  await expect(accept).toBeDisabled();
  await bobCard.getByTestId('vote-up').click(); // Bob takes his thumbs-up back
  await carolCard.getByTestId('vote-up').click();
  await bobCard.getByTestId('vote-up').click();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect.poll(() => editorText(carol.page)).not.toContain(SENTENCE);

  // Turning the setting off lets the requester decide again.
  await bob.page.getByTestId('require-approval').uncheck();
  await expect(alice.page.getByTestId('require-approval')).not.toBeChecked();
  expectNoErrors(alice, bob, carol);
});
