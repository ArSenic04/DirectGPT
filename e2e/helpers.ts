import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export interface UserOptions {
  session: string;
  task: string;
  condition: 'direct' | 'baseline';
  pid: string;
  name: string;
  /** Study role (A, B, C, …); omit for no role. */
  role?: string | null;
  provider?: 'mock' | 'openai';
}

export interface User {
  context: BrowserContext;
  page: Page;
  errors: string[];
  name: string;
}

export function uniqueSession(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export function collabUrl(o: UserOptions): string {
  const q = new URLSearchParams({ session: o.session, task: o.task, condition: o.condition, pid: o.pid, name: o.name });
  if (o.role) q.set('role', o.role);
  q.set('provider', o.provider ?? 'mock');
  q.set('model', 'gpt-4o');
  return `/#/collab?${q.toString()}`;
}

/** A separate browser context = a separate user with its own clipboard, storage and websocket. */
export async function openUser(browser: Browser, o: UserOptions): Promise<User> {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${o.name}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`[${o.name}] pageerror: ${err.message}`));
  page.on('dialog', (d) => void d.accept());
  await page.goto(collabUrl(o));
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.getByTestId('connection')).toContainText('Live');
  return { context, page, errors, name: o.name };
}

export async function editorText(page: Page): Promise<string> {
  return page.getByTestId('editor-content').evaluate((el) =>
    Array.from(el.querySelectorAll('.cm-line'))
      .map((line) => {
        const clone = line.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.cdg-mark-label, .cm-ySelectionInfo, .cm-ySelectionCaret, .cm-widgetBuffer').forEach((n) => n.remove());
        return clone.textContent ?? '';
      })
      .join('\n'),
  );
}

/** Screen coordinates just inside the first and last character of `substring`. */
async function textBox(page: Page, substring: string): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  const box = await page.getByTestId('editor-content').evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => ((n.parentElement?.closest('.cdg-mark-label, .cm-ySelectionInfo') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
    });
    const nodes: Text[] = [];
    let full = '';
    const starts: number[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) {
      starts.push(full.length);
      nodes.push(n as Text);
      full += (n as Text).data;
    }
    const at = full.indexOf(needle);
    if (at === -1) return null;
    const locate = (pos: number) => {
      for (let i = nodes.length - 1; i >= 0; i--) if (starts[i] <= pos) return { node: nodes[i], offset: pos - starts[i] };
      return { node: nodes[0], offset: 0 };
    };
    const first = locate(at);
    const last = locate(at + needle.length - 1);
    const r1 = document.createRange();
    r1.setStart(first.node, first.offset);
    r1.setEnd(first.node, first.offset + 1);
    const r2 = document.createRange();
    r2.setStart(last.node, last.offset);
    r2.setEnd(last.node, last.offset + 1);
    const a = r1.getBoundingClientRect();
    const b = r2.getBoundingClientRect();
    return { x1: a.left + 1, y1: a.top + a.height / 2, x2: b.right - 1, y2: b.top + b.height / 2 };
  }, substring);
  if (!box) throw new Error(`Text not found in editor: ${substring}`);
  return box;
}

/**
 * Select `substring` in the editor with a real mouse drag (press before the
 * first character, release after the last one).
 */
export async function selectText(page: Page, substring: string): Promise<void> {
  const box = await textBox(page, substring);
  // Collapse any existing selection first: pressing inside a selection and
  // moving would drag-and-drop the selected text instead of selecting.
  await page.mouse.click(box.x1, box.y1);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move((box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2, { steps: 4 });
  await page.mouse.move(box.x2, box.y2, { steps: 4 });
  await page.mouse.up();
}

/** Put the caret right after `substring` with a single click. */
export async function clickAfter(page: Page, substring: string): Promise<void> {
  const box = await textBox(page, substring);
  await page.mouse.click(box.x2, box.y2);
}

export function expectNoErrors(...users: User[]): void {
  const errors = users.flatMap((u) => u.errors);
  expect(errors, errors.join('\n')).toEqual([]);
}
