import { describe, expect, it } from 'vitest';
import { classifyScope, expandToParagraphs, expandToSentences, paragraphRangeAt, sentenceRangeAt } from '../shared/scope';
import { buildChatMessages, buildScopedMessages, cleanScopedResult, extractContext } from '../shared/prompts';
import { findChatTarget, mockChat, mockScoped, mockTransform, routeInstruction } from '../shared/mockLLM';
import { parseRoomName, roomName, sanitizeId } from '../shared/room';
import { TASKS, findTask, targetSpans } from '../shared/tasks';

const DOC = 'First one. Second sentence here! Third?\n\nNew paragraph starts. It ends.\n\nLast.';

describe('scope helpers', () => {
  it('finds paragraph and sentence ranges', () => {
    const p2 = paragraphRangeAt(DOC, DOC.indexOf('starts'));
    expect(DOC.slice(p2.from, p2.to)).toBe('New paragraph starts. It ends.');
    const s = sentenceRangeAt(DOC, DOC.indexOf('sentence'));
    expect(DOC.slice(s.from, s.to)).toBe('Second sentence here!');
    const last = sentenceRangeAt(DOC, DOC.indexOf('Third'));
    expect(DOC.slice(last.from, last.to)).toBe('Third?');
  });

  it('expands partial selections to sentences / paragraphs', () => {
    const from = DOC.indexOf('ond');
    const sent = expandToSentences(DOC, { from, to: from + 3 });
    expect(DOC.slice(sent.from, sent.to)).toBe('Second sentence here!');
    const para = expandToParagraphs(DOC, { from, to: from + 3 });
    expect(DOC.slice(para.from, para.to)).toBe('First one. Second sentence here! Third?');
  });

  it('classifies scopes', () => {
    const r = (t: string) => ({ from: DOC.indexOf(t), to: DOC.indexOf(t) + t.length });
    expect(classifyScope(DOC, r('sentence'))).toBe('span');
    expect(classifyScope(DOC, r('Second sentence here!'))).toBe('sentence');
    expect(classifyScope(DOC, r('New paragraph starts. It ends.'))).toBe('paragraph');
    expect(classifyScope(DOC, r('Third?\n\nNew paragraph'))).toBe('section');
    expect(classifyScope(DOC, { from: 0, to: DOC.length })).toBe('document');
  });
});

describe('prompt engineering (DirectGPT <blank> format)', () => {
  it('builds the scoped prompt with context, selection and instruction', () => {
    const msgs = buildScopedMessages({ kind: 'scoped', commandId: 'shorten', instruction: 'Make it shorter.', selection: 'B', contextBefore: 'A ', contextAfter: ' C', variant: 0 });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toBe('A <blank> C\n<blank>: B\n\nINSTRUCTION: Make it shorter.\nRewrite <blank>. Follow INSTRUCTION\n<blank>:');
    const v2 = buildScopedMessages({ kind: 'scoped', commandId: 'shorten', instruction: 'x', selection: 'B', contextBefore: '', contextAfter: '', variant: 2 });
    expect(v2[1].content).toContain('alternative version #3');
  });

  it('puts the whole document in the baseline chat system prompt', () => {
    const msgs = buildChatMessages({ kind: 'chat', document: 'DOC TEXT', messages: [{ role: 'user', content: 'hi' }] });
    expect(msgs[0].content).toContain('<document>\nDOC TEXT\n</document>');
    expect(msgs[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('cleans echoed markers, quotes, fences and restores outer whitespace', () => {
    expect(cleanScopedResult(' old text ', '<blank>: new text')).toBe(' new text ');
    expect(cleanScopedResult('old text', 'old text -> new text')).toBe('new text');
    expect(cleanScopedResult('old', '"new"')).toBe('new');
    expect(cleanScopedResult('"quoted"', '"kept"')).toBe('"kept"');
    expect(cleanScopedResult('old', '```\nnew\n```')).toBe('new');
  });

  it('extracts bounded context around a selection', () => {
    const text = 'a'.repeat(3000) + '\n\nSELECTED' + '\n\n' + 'b'.repeat(3000);
    const from = text.indexOf('SELECTED');
    const ctx = extractContext(text, from, from + 8, 100);
    expect(ctx.before.startsWith('…')).toBe(true);
    expect(ctx.after.endsWith('…')).toBe(true);
    expect(ctx.before.length).toBeLessThanOrEqual(102);
  });
});

describe('MOCK LLM (deterministic)', () => {
  it('is deterministic and keeps outer whitespace', () => {
    const a = mockTransform('rewrite', '', ' This is an important idea. ', 0);
    expect(a).toBe(mockTransform('rewrite', '', ' This is an important idea. ', 0));
    expect(a.startsWith(' ') && a.endsWith(' ')).toBe(true);
    expect(a).not.toBe(' This is an important idea. ');
  });

  it('fixes the grammar errors planted in the study tasks', () => {
    expect(mockTransform('grammar', '', 'Volunteers is needed for the installation day. We dont have alot of tools.', 0))
      .toBe("Volunteers are needed for the installation day. We don't have a lot of tools.");
    expect(mockTransform('grammar', '', 'Training sessions is required. Please register early becuase spots fill up.', 0))
      .toBe('Training sessions are required. Please register early because spots fill up.');
    expect(mockTransform('grammar', '', 'This is fine.', 0)).toBe('This is fine.');
  });

  it('produces shorter text for shorten/summarize and longer text for expand', () => {
    const long = 'The committee spent the winter comparing options, talking to suppliers, reading guides from the city, and visiting two other gardens in the neighbourhood that already collect rainwater, and in the end we chose four large barrels connected to the shed roof.';
    expect(mockTransform('shorten', '', long, 0).length).toBeLessThan(long.length * 0.85);
    const para = 'One sentence here. Another sentence there. A third sentence too.';
    expect(mockTransform('summarize', '', para, 0).length).toBeLessThan(para.length);
    expect(mockTransform('expand', '', 'The barrels will be installed on April 12.', 0).length).toBeGreaterThan(45);
  });

  it('never returns an unchanged or longer text for shorten/summarize, even on short sentences', () => {
    for (const sentence of ['Every AI edit is attributed to the person who requested it.', 'The barrels will be installed on April 12.']) {
      for (const id of ['shorten', 'summarize']) {
        for (const variant of [0, 1, 2]) expect(mockTransform(id, '', sentence, variant).length).toBeLessThan(sentence.length);
      }
    }
  });

  it('changes tone', () => {
    expect(mockTransform('tone-formal', '', "We know life gets busy, so don't worry.", 0)).toContain('do not');
    expect(mockTransform('tone-casual', '', 'We do not require assistance.', 0)).toContain("don't");
  });

  it('regeneration gives a different version', () => {
    const t = 'We need help to start the new plan.';
    expect(mockTransform('rewrite', '', t, 1)).not.toBe(mockTransform('rewrite', '', t, 0));
  });

  it('routes free-text instructions', () => {
    expect(routeInstruction('please make this more concise')).toBe('shorten');
    expect(routeInstruction('Proofread this')).toBe('grammar');
    expect(routeInstruction('sound more professional')).toBe('tone-formal');
    expect(routeInstruction('turn into a bullet list')).toBe('bullets');
    expect(routeInstruction('do something')).toBe('rewrite');
    expect(mockScoped({ kind: 'scoped', commandId: 'custom', instruction: 'make it UPPERCASE', selection: 'abc', contextBefore: '', contextAfter: '', variant: 0 })).toBe('ABC');
  });

  it('baseline chat: finds the referenced passage and returns the document or passage', () => {
    const doc = 'Para one is here.\n\nPara two has “quotes” & more text.\n\nPara three.';
    expect(findChatTarget(doc, 'shorten the second paragraph')).toMatchObject({ from: doc.indexOf('Para two'), quoted: false });
    expect(findChatTarget(doc, 'fix "Para one is here."')).toMatchObject({ from: 0, quoted: true });
    const reply = mockChat({ kind: 'chat', document: doc, messages: [{ role: 'user', content: 'make paragraph 3 uppercase' }] });
    expect(reply.startsWith('Here is the revised document:')).toBe(true);
    expect(reply).toContain('PARA THREE.');
    // whole-document answers show typographic drift outside the requested passage
    expect(reply).toContain('"quotes" and more');
    const passage = mockChat({ kind: 'chat', document: doc, messages: [{ role: 'user', content: 'uppercase "Para one is here."' }] });
    expect(passage).toBe('Here is the revised passage:\n\nPARA ONE IS HERE.');
  });
});

describe('rooms and tasks', () => {
  it('round-trips room names and rejects bad ones', () => {
    const name = roomName({ sessionId: 'pair 01', task: 'T1', condition: 'direct' });
    expect(name).toBe('pair-01.T1.direct');
    expect(parseRoomName(name)).toEqual({ sessionId: 'pair-01', task: 'T1', condition: 'direct' });
    expect(parseRoomName('a.b.c')).toBeNull();
    expect(parseRoomName('a.b')).toBeNull();
    expect(parseRoomName('a/b.T1.direct')).toBeNull();
    expect(sanitizeId('../etc')).toBe('-etc');
  });

  it('every task target exists in its text, T1 and T2 are parallel', () => {
    for (const task of TASKS) expect(() => targetSpans(task)).not.toThrow();
    const t1 = findTask('T1')!;
    const t2 = findTask('T2')!;
    expect(t1.items.map((i) => i.role)).toEqual(t2.items.map((i) => i.role));
    expect(Math.abs(t1.text.length - t2.text.length) / t1.text.length).toBeLessThan(0.1);
    // overlapping items on paragraph 3 merge into one span
    expect(targetSpans(t1).length).toBeLessThan(t1.items.length);
  });
});

import { ORDERS, orderForPair, pairNumberFromSession } from '../shared/counterbalance';
import { copyableText } from '../src/collab/copyable';

describe('counterbalancing', () => {
  it('is a balanced Latin square over condition x document', () => {
    const firsts = ORDERS.map((o) => o[0].condition);
    expect(firsts.filter((c) => c === 'direct')).toHaveLength(2);
    const combos = new Set(ORDERS.flatMap((o) => o.map((b) => `${b.condition}-${b.task}`)));
    expect(combos.size).toBe(4);
    for (const o of ORDERS) {
      expect(o[0].condition).not.toBe(o[1].condition);
      expect(o[0].task).not.toBe(o[1].task);
    }
  });

  it('assigns orders cyclically by pair number', () => {
    expect(orderForPair(1)).toBe(ORDERS[0]);
    expect(orderForPair(5)).toBe(ORDERS[0]);
    expect(orderForPair(4)).toBe(ORDERS[3]);
    expect(pairNumberFromSession('pair07')).toBe(7);
    expect(pairNumberFromSession('demo')).toBeNull();
  });
});

describe('baseline copy button', () => {
  it('copies the answer body without the "Here is…:" lead-in', () => {
    expect(copyableText('Here is the revised passage:\n\nShort text.')).toBe('Short text.');
    expect(copyableText('Just an answer.')).toBe('Just an answer.');
  });
});
