import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { selectText, uniqueSession } from './helpers';

const SENTENCE = 'Every AI edit is attributed to the person who requested it.';

async function openTab(context: BrowserContext, session: string, errors: string[]): Promise<Page> {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/#/collab?session=${session}&task=sandbox&condition=direct&pid=P1&name=Ann&provider=mock`);
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('connection')).toContainText('Live');
  return page;
}

test('opening a second tab of the same participant does not interrupt the first tab\'s AI request; reloading the requesting tab does', async ({ browser }) => {
  const session = uniqueSession('tab2');
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  const first = await openTab(context, session, errors);
  // Hold the LLM answer long enough for a second tab to join while the request is in flight.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  await first.route('**/api/llm', async (route) => {
    await held;
    await route.continue();
  });
  await selectText(first, SENTENCE);
  await first.getByTestId('cmd-shorten').click();
  const card = first.getByTestId('preview-card').first();
  await expect(card).toHaveAttribute('data-status', 'generating');

  const second = await openTab(context, session, errors);
  await expect(second.getByTestId('preview-card').first()).toHaveAttribute('data-status', 'generating');
  await second.waitForTimeout(500);
  release();
  await expect(card).toHaveAttribute('data-status', 'pending');
  await expect(second.getByTestId('preview-card').first()).toHaveAttribute('data-status', 'pending');

  // A request whose tab is reloaded mid-generation is reported as interrupted (not left spinning forever).
  await first.getByTestId('regenerate').click();
  await expect(card).toHaveAttribute('data-status', 'generating');
  await first.unroute('**/api/llm');
  await first.route('**/api/llm', () => undefined); // never answered
  await first.reload();
  await expect(first.getByTestId('workspace')).toBeVisible();
  const after = first.getByTestId('preview-card').first();
  await expect(after).not.toHaveAttribute('data-status', 'generating');
  await expect(after.getByTestId('request-error')).toContainText('interrupted');
  await expect(second.getByTestId('preview-card').first().getByTestId('request-error')).toContainText('interrupted');
  await context.close();
  expect(errors).toEqual([]);
});

test('typing right before leaving is still logged as a manual edit, before session_leave', async ({ browser, request }) => {
  const session = uniqueSession('leave');
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const errors: string[] = [];
  const page = await openTab(context, session, errors);
  await page.getByTestId('editor-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Bye.');
  // Leave well before the periodic 3 s flush.
  await page.goto('about:blank');
  await expect
    .poll(async () => {
      const exp = await (await request.get(`/api/rooms/${session}.sandbox.direct/export`)).json();
      return (exp.events as Array<{ type: string; data: Record<string, unknown> }>)
        .filter((e) => e.type === 'manual_edit' || e.type === 'session_leave')
        .map((e) => (e.type === 'manual_edit' ? `manual_edit:${e.data.inserted}` : e.type));
    })
    .toEqual(['manual_edit:5', 'session_leave']);
  await context.close();
  expect(errors).toEqual([]);
});
