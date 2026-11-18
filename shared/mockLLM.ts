/**
 * MOCK LLM provider — deterministic text transformations.
 *
 * This is NOT a language model. It exists so the whole system (including the
 * end-to-end tests and classroom demos) runs without an API key and gives
 * reproducible results. Every suggestion it produces is labelled "MOCK" in the
 * user interface. Do not use mock sessions as study data.
 */
import type { ChatLLMRequest, LLMRequest, ScopedLLMRequest } from './types';
import { paragraphRangeAt } from './scope';

type Transform = (text: string, variant: number) => string;

/** Replace whole words, preserving the capitalisation of the first letter. */
function replaceWords(text: string, map: Record<string, string>): string {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const pattern = new RegExp(`\\b(${keys.map(escapeRegExp).join('|')})\\b`, 'gi');
  return text.replace(pattern, (match) => {
    const replacement = map[match.toLowerCase()];
    if (replacement === undefined) return match;
    return matchCase(match, replacement);
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchCase(source: string, target: string): string {
  if (source.length > 1 && source === source.toUpperCase() && /[A-Z]/.test(source)) {
    return target.toUpperCase();
  }
  if (source[0] && source[0] === source[0].toUpperCase() && /[A-Za-z]/.test(source[0])) {
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  return target;
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’)]*|$)/g) ?? [text];
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function capitalizeSentences(text: string): string {
  return text
    .replace(/^(\s*["'“‘(]?)([a-z])/, (_m, p: string, c: string) => p + c.toUpperCase())
    .replace(/([.!?]\s+["'“‘(]?)([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

function tidy(text: string): string {
  return capitalizeSentences(
    text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/,\s*,/g, ',')
      .replace(/\(\s*\)/g, '')
      .replace(/^[\s,;]+/, '')
      .trim(),
  );
}

function keepOuterWhitespace(original: string, result: string): string {
  const before = original.match(/^\s*/)?.[0] ?? '';
  const after = original.match(/\s*$/)?.[0] ?? '';
  return before + result.trim() + after;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MISSPELLINGS: Record<string, string> = {
  teh: 'the', recieve: 'receive', recieved: 'received', occured: 'occurred', seperate: 'separate',
  definately: 'definitely', alot: 'a lot', wich: 'which', becuase: 'because', untill: 'until',
  thier: 'their', dont: "don't", doesnt: "doesn't", cant: "can't", wont: "won't", isnt: "isn't",
  arent: "aren't", didnt: "didn't", goverment: 'government', enviroment: 'environment',
  tommorow: 'tomorrow', begining: 'beginning', beleive: 'believe', accomodate: 'accommodate',
  neccessary: 'necessary', succesful: 'successful', publically: 'publicly', wierd: 'weird',
  occassion: 'occasion', commitee: 'committee', reccomend: 'recommend', adress: 'address',
};

const NOT_PLURAL = new Set(['this', 'his', 'its', 'is', 'was', 'us', 'yes', 'bus', 'gas', 'process', 'class', 'campus', 'access']);

const fixGrammar: Transform = (text) => {
  let out = replaceWords(text, MISSPELLINGS);
  out = out.replace(/\b(\w+)\s+\1\b/gi, '$1');
  out = out.replace(/(^|\s)i(?=[\s,.!?']|$)/g, '$1I');
  out = out.replace(/\b([A-Za-z]+s) is (needed|required|welcome|invited|expected|asked|limited)\b/g, (m, noun: string, verb: string) =>
    NOT_PLURAL.has(noun.toLowerCase()) ? m : `${noun} are ${verb}`,
  );
  out = out.replace(/\b(they|we|you) was\b/gi, (_m, s: string) => `${s} were`);
  out = out.replace(/\b(he|she|it) don't\b/gi, (_m, s: string) => `${s} doesn't`);
  out = out.replace(/\b(he|she|it) have\b/gi, (_m, s: string) => `${s} has`);
  out = out.replace(/\b(there|here) is (many|several|two|three|four|five|lots)\b/gi, (_m, a: string, b: string) => `${a} are ${b}`);
  out = out.replace(/\b([Aa]) (?=(?:[aeio]|u(?![nr]i|s[eu]))\w)/g, (_m, a: string) => (a === 'A' ? 'An ' : 'an '));
  out = out.replace(/\s+([,.;:!?])/g, '$1').replace(/([,;:])(?=[A-Za-z])/g, '$1 ');
  out = out.replace(/[ \t]{2,}/g, ' ');
  out = capitalizeSentences(out);
  return out;
};

const FORMAL: Record<string, string> = {
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "won't": 'will not',
  "isn't": 'is not', "aren't": 'are not', "it's": 'it is', "we're": 'we are', "they're": 'they are',
  "you're": 'you are', "i'm": 'I am', "let's": 'let us', "we'll": 'we will', "you'll": 'you will',
  "that's": 'that is', "there's": 'there is', "we've": 'we have', "wasn't": 'was not',
  'a lot of': 'many', 'lots of': 'numerous', kids: 'children', big: 'substantial', buy: 'purchase', need: 'require', needs: 'requires',
  show: 'demonstrate', start: 'begin', pretty: 'rather', awesome: 'excellent', great: 'excellent',
  okay: 'acceptable', ok: 'acceptable', stuff: 'materials', things: 'matters', think: 'believe',
  also: 'additionally', really: 'considerably', folks: 'people',
  'find out': 'determine', 'set up': 'establish', 'help out': 'assist', 'come up with': 'develop',
  cool: 'impressive', tons: 'a great deal', hey: 'hello', yeah: 'yes', guys: 'everyone',
  'we know': 'we understand', 'make it': 'attend', 'are going away': 'will be away', 'is going away': 'will be away',
};

const CASUAL: Record<string, string> = {
  'do not': "don't", 'does not': "doesn't", 'did not': "didn't", cannot: "can't", 'will not': "won't",
  'is not': "isn't", 'are not': "aren't", 'it is': "it's", 'we are': "we're", 'they are': "they're",
  'you are': "you're", 'let us': "let's", 'we will': "we'll", 'that is': "that's",
  therefore: 'so', however: 'but', purchase: 'buy', assist: 'help', require: 'need', requires: 'needs',
  approximately: 'about', children: 'kids', numerous: 'lots of', commence: 'start', obtain: 'get',
  additionally: 'also', furthermore: 'plus', demonstrate: 'show', individuals: 'people',
  'in order to': 'to', substantial: 'big', sufficient: 'enough', regarding: 'about',
  residents: 'neighbours', attend: 'come to', participate: 'join in', excellent: 'great',
};

const formalTone: Transform = (text, variant) => {
  let out = replaceWords(replaceWords(text, MISSPELLINGS), FORMAL)
    .replace(/\blet (the [\w ]+?|us|me) know\b/gi, (_m, who: string) => `inform ${who}`)
    .replace(/!+/g, '.');
  out = tidy(out);
  if (variant % 2 === 1) out = `Please note that ${out.charAt(0).toLowerCase()}${out.slice(1)}`;
  return out;
};
const casualTone: Transform = (text) => tidy(replaceWords(text, CASUAL));
const friendlyTone: Transform = (text, variant) => {
  let out = casualTone(fixGrammar(text, variant), variant);
  const opener = ['Hi everyone! ', 'Good news! ', 'Friendly reminder: '][variant % 3];
  out = opener + out;
  out = out.replace(/\.(\s*)$/, '!$1');
  return out;
};

const FILLERS = [
  'very', 'really', 'just', 'quite', 'actually', 'basically', 'simply', 'literally', 'extremely',
  'totally', 'certainly', 'definitely', 'truly', 'rather', 'somewhat', 'indeed', 'essentially',
];
const WORDY: Record<string, string> = {
  'in order to': 'to', 'due to the fact that': 'because', 'at this point in time': 'now',
  'a large number of': 'many', 'a great deal of': 'much', 'in the event that': 'if',
  'for the purpose of': 'to', 'with regard to': 'about', 'is able to': 'can', 'are able to': 'can',
  'it is important to note that': '', 'that being said,': '', 'as a matter of fact,': '',
  'each and every': 'every', 'the majority of': 'most', 'in spite of the fact that': 'although',
};

const shorten: Transform = (text, variant) => {
  let out = replaceWords(text, WORDY);
  out = out.replace(new RegExp(`\\b(${FILLERS.join('|')})\\s+`, 'gi'), '');
  out = out.replace(/\s*\([^)]*\)/g, '');
  out = out.replace(/,\s*which[^,.;]*,/gi, '');
  out = tidy(out);
  const aggressive = variant > 0 || out.length > text.trim().length * 0.85;
  if (aggressive) {
    out = splitSentences(out)
      .map((s) => {
        const parts = s.split(/,\s*/);
        if (parts.length > 2) {
          const last = parts[parts.length - 1].replace(/^(and|but|so|then)\s+/i, '');
          // Odd variants keep only the conclusion, even variants keep the opening and the conclusion.
          if (variant % 2 === 1) return last.charAt(0).toUpperCase() + last.slice(1);
          return `${parts[0]}, and ${last}`;
        }
        return s;
      })
      .join(' ');
  }
  return tidy(out);
};

const EXPAND_TEMPLATES = [
  (topic: string) => `We will share more details about ${topic} as the date approaches, so keep an eye on your inbox.`,
  (topic: string) => `If you have any questions about ${topic}, the coordinators will be happy to help.`,
  (topic: string) => `Everyone is welcome to take part, and ${topic} should make a visible difference within a few weeks.`,
];

const VERBS = /^(is|are|was|were|will|would|can|could|should|has|have|had|may|might|must|does|do|did|takes|took|opens|starts|begins|runs)$/i;

/** The grammatical subject of the first sentence (words before its first verb). */
function topicOf(text: string): string {
  const first = splitSentences(text)[0] ?? text;
  const words = first.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
  const verbAt = words.findIndex((w) => VERBS.test(w));
  if (verbAt <= 0 || verbAt > 6) return 'this';
  const subject = words.slice(0, verbAt).join(' ');
  return /^[A-Z][a-z]/.test(subject) && !/^(The|A|An|Our|This|That|These|Those|Each|Every)\b/.test(subject)
    ? subject
    : subject.charAt(0).toLowerCase() + subject.slice(1);
}

const expand: Transform = (text, variant) => {
  const trimmed = text.trim();
  const sentence = EXPAND_TEMPLATES[variant % EXPAND_TEMPLATES.length](topicOf(trimmed));
  const ended = /[.!?…]["'”’)]*$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return `${ended} ${sentence}`;
};

const summarize: Transform = (text, variant) => {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return shorten(text, variant + 1);
  const pick = variant % 2 === 0 ? sentences[0] : sentences[sentences.length - 1];
  return shorten(pick, 1);
};

const PLAIN: Record<string, string> = {
  utilize: 'use', utilise: 'use', leverage: 'use', facilitate: 'help', commence: 'begin',
  endeavor: 'try', 'in lieu of': 'instead of', 'prior to': 'before', 'subsequent to': 'after',
  aforementioned: 'this', approximately: 'about', numerous: 'many', sufficient: 'enough',
  ascertain: 'find out', demonstrate: 'show', remuneration: 'pay', terminate: 'end',
  additionally: 'also', consequently: 'so', nevertheless: 'still', methodology: 'method',
  'in the vicinity of': 'near', 'with the exception of': 'except', 'a number of': 'several',
};

const clarify: Transform = (text) => {
  let out = replaceWords(text, PLAIN);
  out = splitSentences(out)
    .map((s) => {
      if (s.split(/\s+/).length <= 18) return s;
      const m = s.match(/^(.*)(?:;\s*|,\s*(?:and|but|so|which)\s+)(.*)$/i);
      if (!m) return s;
      const first = m[1].replace(/[,;]\s*$/, '');
      const second = m[2];
      return `${first}. ${second.charAt(0).toUpperCase()}${second.slice(1)}`;
    })
    .join(' ');
  return tidy(out);
};

const SYNONYMS: Record<string, string[]> = {
  important: ['key', 'crucial', 'essential'], help: ['support', 'assist', 'aid'],
  helps: ['supports', 'assists', 'aids'], many: ['numerous', 'several', 'a number of'],
  show: ['demonstrate', 'reveal', 'illustrate'], use: ['employ', 'rely on', 'make use of'],
  improve: ['enhance', 'strengthen', 'boost'], big: ['large', 'major', 'substantial'],
  small: ['modest', 'minor', 'little'], quickly: ['rapidly', 'swiftly', 'promptly'],
  start: ['begin', 'launch', 'kick off'], make: ['create', 'build', 'produce'],
  good: ['strong', 'solid', 'positive'], problem: ['issue', 'challenge', 'difficulty'],
  idea: ['concept', 'notion', 'proposal'], people: ['individuals', 'community members', 'participants'],
  also: ['additionally', 'moreover', 'as well'], new: ['fresh', 'novel', 'recent'],
  need: ['require', 'call for', 'demand'], want: ['wish', 'hope', 'aim'], plan: ['strategy', 'scheme', 'roadmap'],
  goal: ['aim', 'objective', 'target'], easy: ['simple', 'straightforward', 'effortless'],
  hard: ['difficult', 'challenging', 'tough'], change: ['shift', 'adjustment', 'modification'],
  space: ['area', 'room', 'place'], provide: ['offer', 'supply', 'deliver'], allow: ['let', 'enable', 'permit'],
  find: ['discover', 'locate', 'identify'], keep: ['maintain', 'retain', 'preserve'],
  group: ['team', 'circle', 'collective'], members: ['participants', 'volunteers', 'contributors'],
  local: ['neighbourhood', 'nearby', 'community'], meeting: ['session', 'gathering', 'get-together'],
  together: ['jointly', 'side by side', 'as a group'], share: ['exchange', 'pass on', 'offer'],
  each: ['every', 'every single', 'each individual'], learn: ['discover', 'pick up', 'master'],
};

const rewrite: Transform = (text, variant) => {
  const seed = hash(text);
  let changed = false;
  const keys = Object.keys(SYNONYMS);
  const pattern = new RegExp(`\\b(${keys.join('|')})\\b`, 'gi');
  let index = 0;
  const out = text.replace(pattern, (match) => {
    const options = SYNONYMS[match.toLowerCase()];
    if (!options) return match;
    const choice = options[(seed + variant + index++) % options.length];
    changed = true;
    return matchCase(match, choice);
  });
  if (changed) return tidy(out);
  // Nothing to substitute: restructure the first sentence instead.
  const m = text.trim().match(/^(When|If|Because|Although|While|After|Before) ([^,]+), (.+?)([.!?])$/);
  if (m) {
    return `${m[3].charAt(0).toUpperCase()}${m[3].slice(1)} ${m[1].toLowerCase()} ${m[2]}${m[4]}`;
  }
  const openers = ['In other words, ', 'Put simply, ', 'To put it another way, '];
  const t = text.trim();
  return openers[variant % openers.length] + t.charAt(0).toLowerCase() + t.slice(1);
};

const toUpper: Transform = (text) => text.toUpperCase();
const toLower: Transform = (text) => text.toLowerCase();
const futureTense: Transform = (text) =>
  tidy(
    text
      .replace(/\b(is|are|was|were)\b/gi, (m) => matchCase(m, 'will be'))
      .replace(/\b(has|have|had)\b/gi, (m) => matchCase(m, 'will have')),
  );
const bullets: Transform = (text) => splitSentences(text).map((s) => `- ${s}`).join('\n');

export const MOCK_TRANSFORMS: Record<string, Transform> = {
  rewrite,
  summarize,
  clarify,
  shorten,
  expand,
  grammar: fixGrammar,
  'tone-formal': formalTone,
  'tone-casual': casualTone,
  'tone-friendly': friendlyTone,
  uppercase: toUpper,
  lowercase: toLower,
  future: futureTense,
  bullets,
};

/** Route a free-text instruction to one of the mock transforms. */
export function routeInstruction(instruction: string): string {
  const s = instruction.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/summar|tl;?dr|gist/, 'summarize'],
    [/short|concise|trim|cut|brief|condense|fewer words/, 'shorten'],
    [/grammar|spelling|typo|proofread|punctuation|correct/, 'grammar'],
    [/formal|professional|polite|academic/, 'tone-formal'],
    [/casual|informal|relaxed|conversational/, 'tone-casual'],
    [/friendly|warm|enthusiastic|cheerful/, 'tone-friendly'],
    [/clear|clarif|simpl|plain|understand/, 'clarify'],
    [/expand|elaborat|detail|longer|describe|more about/, 'expand'],
    [/upper ?case|all caps|capitali[sz]e/, 'uppercase'],
    [/lower ?case/, 'lowercase'],
    [/future tense|future/, 'future'],
    [/bullet|list/, 'bullets'],
  ];
  for (const [re, id] of rules) if (re.test(s)) return id;
  return 'rewrite';
}

export function mockTransform(commandId: string, instruction: string, text: string, variant: number): string {
  const id = MOCK_TRANSFORMS[commandId] ? commandId : routeInstruction(instruction);
  const transform = MOCK_TRANSFORMS[id];
  const core = text.trim();
  if (core.length === 0) return text;
  let result = transform(core, variant);
  if (result === core && variant > 0) {
    // Regeneration must offer a visibly different alternative where possible.
    result = rewrite(core, variant);
  }
  return keepOuterWhitespace(text, result);
}

export function mockScoped(req: ScopedLLMRequest): string {
  return mockTransform(req.commandId, req.instruction, req.selection, req.variant);
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6 };

/** Find which part of the document a chat message refers to. */
export function findChatTarget(document: string, message: string): { from: number; to: number; quoted: boolean } {
  // 1. A quoted passage that appears verbatim in the document.
  const quoteRe = /"([^"]{12,})"|“([^”]{12,})”|«([^»]{12,})»/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(message)) !== null) {
    const q = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const idx = document.indexOf(q);
    if (idx !== -1) return { from: idx, to: idx + q.length, quoted: true };
  }
  // 2. "paragraph 2", "second paragraph", "last paragraph".
  const paragraphs: Array<{ from: number; to: number }> = [];
  let pos = 0;
  while (pos < document.length) {
    const r = paragraphRangeAt(document, pos);
    if (r.to > r.from) paragraphs.push(r);
    const next = document.indexOf('\n\n', r.to);
    if (next === -1) break;
    pos = next + 2;
  }
  const lower = message.toLowerCase();
  let n: number | undefined;
  const num = lower.match(/paragraph\s*(\d+)/);
  if (num) n = Number(num[1]);
  const ord = lower.match(/\b(first|second|third|fourth|fifth|sixth|last)\s+paragraph/);
  if (ord) n = ord[1] === 'last' ? paragraphs.length : ORDINALS[ord[1]];
  if (n !== undefined && n >= 1 && n <= paragraphs.length) {
    return { ...paragraphs[n - 1], quoted: false };
  }
  return { from: 0, to: document.length, quoted: false };
}

/**
 * Simulates the "whole-document regeneration drift" commonly seen when a chat
 * model returns an entire document: typographic normalisation outside the
 * requested passage. Only applied when the mock returns the full document.
 */
export function regenerationDrift(text: string): string {
  return text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/ & /g, ' and ');
}

export function mockChat(req: ChatLLMRequest): string {
  const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
  const message = lastUser?.content ?? '';
  const doc = req.document;
  if (doc.trim().length === 0) {
    return '[MOCK] The document is empty, so there is nothing to edit yet.';
  }
  const target = findChatTarget(doc, message);
  const commandId = routeInstruction(message);
  const variant = req.messages.filter((m) => m.role === 'assistant').length;
  const passage = doc.slice(target.from, target.to);
  const revised = mockTransform(commandId, message, passage, variant).trim();
  if (target.quoted) {
    return `Here is the revised passage:\n\n${revised}`;
  }
  const full = doc.slice(0, target.from) + revised + doc.slice(target.to);
  return `Here is the revised document:\n\n${regenerationDrift(full).trim()}`;
}

export function mockComplete(request: LLMRequest): string {
  return request.kind === 'scoped' ? mockScoped(request) : mockChat(request);
}
