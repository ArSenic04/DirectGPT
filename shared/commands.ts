/**
 * Toolbar of reusable AI commands (Figure 1, step 3).
 *
 * DirectGPT introduced a toolbar of reusable prompt commands; here the
 * commands are fixed for the study (so both partners see the same set) and
 * collaborators can additionally save their own custom instructions to a
 * toolbar that is shared through the Y.Doc.
 */

export type ToneId = 'formal' | 'casual' | 'friendly';

export interface CommandDefinition {
  id: string;
  label: string;
  /** Short description shown as a tooltip. */
  hint: string;
  instruction: string;
}

export const TONES: readonly ToneId[] = ['formal', 'casual', 'friendly'];

export const BUILTIN_COMMANDS: readonly CommandDefinition[] = [
  {
    id: 'rewrite',
    label: 'Rewrite',
    hint: 'Say the same thing in different words',
    instruction: 'Rewrite this text in different words while keeping its meaning.',
  },
  {
    id: 'summarize',
    label: 'Summarize',
    hint: 'Condense to the key point',
    instruction: 'Summarize this text concisely.',
  },
  {
    id: 'clarify',
    label: 'Clarify',
    hint: 'Make it clearer and easier to understand',
    instruction: 'Make this text clearer and easier to understand.',
  },
  {
    id: 'shorten',
    label: 'Shorten',
    hint: 'Make it shorter, keep key information',
    instruction: 'Make this text shorter while keeping the key information.',
  },
  {
    id: 'expand',
    label: 'Expand',
    hint: 'Add more detail',
    instruction: 'Expand this text with more detail.',
  },
  {
    id: 'grammar',
    label: 'Fix grammar',
    hint: 'Fix grammar, spelling and punctuation',
    instruction: 'Fix grammar, spelling and punctuation errors without changing the meaning.',
  },
];

export function toneCommand(tone: ToneId): CommandDefinition {
  return {
    id: `tone-${tone}`,
    label: `Tone: ${tone}`,
    hint: `Change the tone to ${tone}`,
    instruction: `Change the tone of this text to be ${tone}.`,
  };
}

export const ALL_COMMANDS: readonly CommandDefinition[] = [
  ...BUILTIN_COMMANDS,
  ...TONES.map(toneCommand),
];

export function findCommand(id: string): CommandDefinition | undefined {
  return ALL_COMMANDS.find((c) => c.id === id);
}

export const CUSTOM_COMMAND_ID = 'custom';
