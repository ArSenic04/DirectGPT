/**
 * Post-task questionnaire: 7-point Likert items for the proposal's
 * constructs (perceived control, transparency, coordination) and the raw
 * NASA Task Load Index (six 0–100 subscales, mean = raw TLX).
 */

export interface LikertItem {
  id: string;
  construct: 'control' | 'transparency' | 'coordination';
  text: string;
}

export const LIKERT_SCALE = { min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' } as const;

export const LIKERT_ITEMS: readonly LikertItem[] = [
  { id: 'control1', construct: 'control', text: 'I felt in control of what the AI changed in our document.' },
  { id: 'control2', construct: 'control', text: 'I could limit AI changes to exactly the text I intended.' },
  { id: 'control3', construct: 'control', text: 'I could easily reject AI changes I did not want.' },
  { id: 'transp1', construct: 'transparency', text: 'I could tell which parts of the document were changed by the AI.' },
  { id: 'transp2', construct: 'transparency', text: 'I knew who requested each AI change.' },
  { id: 'transp3', construct: 'transparency', text: 'I could see what the AI was going to change before it was applied.' },
  { id: 'coord1', construct: 'coordination', text: 'I was aware of what my partner was working on.' },
  { id: 'coord2', construct: 'coordination', text: 'My partner\'s AI edits did not disrupt my own work.' },
  { id: 'coord3', construct: 'coordination', text: 'It was easy to coordinate edits with my partner.' },
];

export interface TlxScale {
  id: string;
  label: string;
  question: string;
  low: string;
  high: string;
}

export const TLX_SCALES: readonly TlxScale[] = [
  { id: 'mental', label: 'Mental demand', question: 'How mentally demanding was the task?', low: 'Very low', high: 'Very high' },
  { id: 'physical', label: 'Physical demand', question: 'How physically demanding was the task?', low: 'Very low', high: 'Very high' },
  { id: 'temporal', label: 'Temporal demand', question: 'How hurried or rushed was the pace of the task?', low: 'Very low', high: 'Very high' },
  { id: 'performance', label: 'Performance', question: 'How successful were you in accomplishing what you were asked to do?', low: 'Perfect', high: 'Failure' },
  { id: 'effort', label: 'Effort', question: 'How hard did you have to work to accomplish your level of performance?', low: 'Very low', high: 'Very high' },
  { id: 'frustration', label: 'Frustration', question: 'How insecure, discouraged, irritated, stressed, and annoyed were you?', low: 'Very low', high: 'Very high' },
];

export interface QuestionnaireScores {
  control: number | null;
  transparency: number | null;
  coordination: number | null;
  tlxRaw: number | null;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function scoreQuestionnaire(likert: Record<string, number>, tlx: Record<string, number>): QuestionnaireScores {
  const byConstruct = (c: LikertItem['construct']) =>
    mean(LIKERT_ITEMS.filter((i) => i.construct === c).map((i) => likert[i.id]).filter((v): v is number => typeof v === 'number'));
  return {
    control: byConstruct('control'),
    transparency: byConstruct('transparency'),
    coordination: byConstruct('coordination'),
    tlxRaw: mean(TLX_SCALES.map((s) => tlx[s.id]).filter((v): v is number => typeof v === 'number')),
  };
}

export function isQuestionnaireComplete(likert: Record<string, number>, tlx: Record<string, number>): boolean {
  return LIKERT_ITEMS.every((i) => typeof likert[i.id] === 'number') && TLX_SCALES.every((s) => typeof tlx[s.id] === 'number');
}
