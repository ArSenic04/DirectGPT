/**
 * Study tasks: paired collaborative revision tasks (see docs/STUDY_PROTOCOL.md).
 *
 * Each task is a short document plus revision items split between partner A
 * and partner B. The `target` of an item is the exact passage of the initial
 * document the item asks to change; the union of targets is the "intended
 * scope" used by the unintended-modification metric. T1 and T2 are parallel
 * (same structure, length and item types) so they can be counterbalanced
 * against the two conditions. One item per task deliberately overlaps the
 * partner's item (same paragraph) to create a coordination situation.
 *
 * All texts were written for this project.
 */
import type { Span } from './diff';

export interface TaskItem {
  id: string;
  role: 'A' | 'B';
  instruction: string;
  /** Exact passage of the initial text this item asks to change. */
  target: string;
}

export interface TaskDefinition {
  id: string;
  title: string;
  description: string;
  text: string;
  items: TaskItem[];
}

const T1_TEXT = `Welcome to the spring edition of the Maple Street Community Garden newsletter. This season we are welcoming twelve new families, and every plot in the north bed has now been assigned. Thank you to everyone who helped clear the paths last month.

Our biggest change this year is the new rainwater system. The committee spent the winter comparing options, talking to suppliers, reading guides from the city, and visiting two other gardens in the neighbourhood that already collect rainwater, and in the end we chose four large barrels connected to the shed roof. The barrels will be installed on April 12.

Volunteers is needed for the installation day. We dont have alot of tools, so please bring gloves, a shovel or a wheelbarrow if you can. Lunch will be provided by the Rossi family.

Finally, a reminder about watering. During hot weeks, plots that are not watered for more than five days will get a friendly note, and after two notes the plot may be offered to the next family on the waiting list. We know life gets busy, so if you are going away, ask a neighbour to help out and let the coordinators know.`;

const T2_TEXT = `The Riverside Public Library is opening a makerspace on the second floor this fall. The room will have three 3D printers, a laser cutter, sewing machines and a small electronics bench. Everyone with a library card can book the space for free.

Planning the makerspace took almost two years. The library staff surveyed more than four hundred residents, visited makerspaces in three nearby cities, consulted local teachers and hobby groups, and tested several layouts with volunteers, and in the end they chose a design that keeps the noisy machines away from the reading area. The official opening is on September 20.

Training sessions is required before using the laser cutter. Each session takes about an hour, so please register early becuase spots fill up quickly. The sessions will be led by volunteers from the Riverside Robotics Club.

Finally, a reminder about bookings. Members who leave machines dirty or forget to cancel a booking more than twice will get a warning by email, and after two warnings they may lose booking privileges for a month. We know plans change, so if you cant make it, cancel online and let the front desk know.`;

const PRACTICE_TEXT = `Our study group meets every Thursday evening in room 204. We review the week's readings, share notes, and plan the next assignment together.

This month we want to try something new. Each member will present one paper for ten minutes, and the group will ask questions afterwards. Please sign up for a date on the shared sheet.`;

const SANDBOX_TEXT = `Collaborative DirectGPT lets several people edit one document with help from an AI assistant. Select any sentence or paragraph, choose a command such as Shorten or Fix grammar, and review the suggestion before it changes the shared text.

Every AI edit is attributed to the person who requested it. The history panel shows what changed, who approved it, and lets anyone revert an accepted edit.

If a collaborator edits the selected text while a suggestion is pending, the request is flagged as conflicted, so nobody overwrites a partner's work by accident.`;

export const TASKS: readonly TaskDefinition[] = [
  {
    id: 'practice',
    title: 'Practice: Study group note',
    description: 'A short warm-up so both partners can try the interface. Not analysed.',
    text: PRACTICE_TEXT,
    items: [
      { id: 'P-A1', role: 'A', instruction: 'Make the first sentence more formal.', target: 'Our study group meets every Thursday evening in room 204.' },
      { id: 'P-B1', role: 'B', instruction: 'Shorten the second paragraph.', target: 'This month we want to try something new. Each member will present one paper for ten minutes, and the group will ask questions afterwards. Please sign up for a date on the shared sheet.' },
    ],
  },
  {
    id: 'T1',
    title: 'Task 1: Community garden newsletter',
    description: 'Revise the spring newsletter with your partner. Each of you has three items; do yours and keep an eye on your partner\'s.',
    text: T1_TEXT,
    items: [
      { id: 'T1-A1', role: 'A', instruction: 'Shorten the long second sentence of paragraph 2 (the one about the committee).', target: 'The committee spent the winter comparing options, talking to suppliers, reading guides from the city, and visiting two other gardens in the neighbourhood that already collect rainwater, and in the end we chose four large barrels connected to the shed roof.' },
      { id: 'T1-A2', role: 'A', instruction: 'Fix the grammar and spelling mistakes in paragraph 3.', target: 'Volunteers is needed for the installation day. We dont have alot of tools, so please bring gloves, a shovel or a wheelbarrow if you can. Lunch will be provided by the Rossi family.' },
      { id: 'T1-A3', role: 'A', instruction: 'Make the last sentence of the newsletter more formal.', target: 'We know life gets busy, so if you are going away, ask a neighbour to help out and let the coordinators know.' },
      { id: 'T1-B1', role: 'B', instruction: 'Summarize paragraph 1 into a single sentence.', target: 'Welcome to the spring edition of the Maple Street Community Garden newsletter. This season we are welcoming twelve new families, and every plot in the north bed has now been assigned. Thank you to everyone who helped clear the paths last month.' },
      { id: 'T1-B2', role: 'B', instruction: 'Expand the sentence about the installation date with more detail.', target: 'The barrels will be installed on April 12.' },
      { id: 'T1-B3', role: 'B', instruction: 'Make paragraph 3 sound friendlier (your partner also has an item on this paragraph: coordinate!).', target: 'Volunteers is needed for the installation day. We dont have alot of tools, so please bring gloves, a shovel or a wheelbarrow if you can. Lunch will be provided by the Rossi family.' },
    ],
  },
  {
    id: 'T2',
    title: 'Task 2: Library makerspace announcement',
    description: 'Revise the announcement with your partner. Each of you has three items; do yours and keep an eye on your partner\'s.',
    text: T2_TEXT,
    items: [
      { id: 'T2-A1', role: 'A', instruction: 'Shorten the long second sentence of paragraph 2 (the one about the library staff).', target: 'The library staff surveyed more than four hundred residents, visited makerspaces in three nearby cities, consulted local teachers and hobby groups, and tested several layouts with volunteers, and in the end they chose a design that keeps the noisy machines away from the reading area.' },
      { id: 'T2-A2', role: 'A', instruction: 'Fix the grammar and spelling mistakes in paragraph 3.', target: 'Training sessions is required before using the laser cutter. Each session takes about an hour, so please register early becuase spots fill up quickly. The sessions will be led by volunteers from the Riverside Robotics Club.' },
      { id: 'T2-A3', role: 'A', instruction: 'Make the last sentence of the announcement more formal.', target: 'We know plans change, so if you cant make it, cancel online and let the front desk know.' },
      { id: 'T2-B1', role: 'B', instruction: 'Summarize paragraph 1 into a single sentence.', target: 'The Riverside Public Library is opening a makerspace on the second floor this fall. The room will have three 3D printers, a laser cutter, sewing machines and a small electronics bench. Everyone with a library card can book the space for free.' },
      { id: 'T2-B2', role: 'B', instruction: 'Expand the sentence about the opening date with more detail.', target: 'The official opening is on September 20.' },
      { id: 'T2-B3', role: 'B', instruction: 'Make paragraph 3 sound friendlier (your partner also has an item on this paragraph: coordinate!).', target: 'Training sessions is required before using the laser cutter. Each session takes about an hour, so please register early becuase spots fill up quickly. The sessions will be led by volunteers from the Riverside Robotics Club.' },
    ],
  },
  {
    id: 'sandbox',
    title: 'Sandbox (free exploration)',
    description: 'A free document to explore the system. Not part of the study.',
    text: SANDBOX_TEXT,
    items: [],
  },
];

/** Look up a task by id, case-insensitively ("t1" finds "T1", "Sandbox" finds "sandbox"). */
export function findTask(id: string): TaskDefinition | undefined {
  const key = (id ?? '').trim().toLowerCase();
  return TASKS.find((t) => t.id.toLowerCase() === key);
}

/** Intended-scope spans (positions in the initial text), merged and sorted. */
export function targetSpans(task: TaskDefinition): Span[] {
  const spans: Span[] = [];
  for (const item of task.items) {
    const at = task.text.indexOf(item.target);
    if (at === -1) throw new Error(`Task ${task.id}: target of ${item.id} not found in text`);
    spans.push({ from: at, to: at + item.target.length });
  }
  spans.sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else merged.push({ ...s });
  }
  return merged;
}
