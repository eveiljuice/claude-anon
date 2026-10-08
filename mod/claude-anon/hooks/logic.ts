// Чистая логика режима claude anon — без движковых вызовов, только правила.
import type { PromptComposeSection, PromptContextBlock } from 'claude-code'

export type AnonDecision = {
  want: boolean
  refuse: boolean
  refuseText: string
}

export const ANON_POLICY_ID = 'anon-mode:policy'

export const BAND_SUFFIX = 'memory writes blocked'

export function decideAnon(arg: string, current: boolean, launcher: boolean): AnonDecision {
  const spoken = arg.trim().toLowerCase()

  if (spoken === 'on') {
    return { want: true, refuse: false, refuseText: '' }
  }

  const want = spoken === 'off' ? false : !current

  // Лаунчер-профиль всегда инкогнито (§3.2): off любой формы — явной или
  // голым toggle (Shift+Tab при включённом) — отказывает.
  if (!want && launcher && current) {
    return {
      want: false,
      refuse: true,
      refuseText: 'claude anon: this profile is always incognito',
    }
  }
  return { want, refuse: false, refuseText: '' }
}

export function bandNote(launcher: boolean, contextUnloaded: boolean): string {
  if (launcher) {
    return 'session not saved' // launcher: память выключена на старте, выгрузки не было
  }
  return contextUnloaded ? 'memory unloaded' : 'context loaded before going anon'
}

// --- чистый контекст: блоки/секции/вложения, которые анон не пускает ---

/** Блоки первого хода с личными данными (см. d.ts PromptContextBlocks). */
export const CONTEXT_DROP_BLOCKS = [
  'claudeMd',
  'userEmail',
  'attachedProject',
  'gitStatus',
] as const

/** Секции системного промпта, несущие память о пользователе (d.ts пример: memory;
 * pronouns — сессия-секция из d.ts). */
export const MEMORY_SECTION_IDS = ['memory', 'pronouns'] as const

/** Вложения per-turn, несущие память (d.ts prompt.attachment). */
export const MEMORY_ATTACHMENT_TYPES = [
  'relevant_memories',
  'nested_memory',
  'current_session_memory',
  'team_context',
] as const

export function dropContextBlocks(
  blocks: readonly PromptContextBlock[],
): PromptContextBlock[] {
  return blocks.filter(b => !(CONTEXT_DROP_BLOCKS as readonly string[]).includes(b.name))
}

export function stripMemorySections(
  sections: readonly PromptComposeSection[],
): PromptComposeSection[] {
  return sections.filter(s => !(MEMORY_SECTION_IDS as readonly string[]).includes(s.id))
}

// --- confirm-баннер перед первым включением (аналог WARNING dangerously-skip-permissions) ---

/** Точное слово согласия; остальное (включая «yes, i accept») — отказ. */
export const CONFIRM_ACCEPT = 'Yes, I accept'

export function confirmOptions(): readonly string[] {
  return ['No (default)', CONFIRM_ACCEPT]
}

export function confirmQuestion(): string {
  return (
    'WARNING: claude anon — enable incognito mode?\n\n' +
    'This session will not be saved: the transcript is deleted when it ends (no resume).\n' +
    'Memory is not written and not referenced: MEMORY.md, auto-memory, CLAUDE.md and past ' +
    'prompts are unloaded here.\n' +
    "Writes under the engine's projects directory (session data, memory) are blocked.\n" +
    'The terminal window title is taken over while the mode is on.\n\n' +
    'Turning the mode off later does not unload context already loaded, and conversations ' +
    'started incognito stay unsaved.\n' +
    'Enable claude anon?'
  )
}

/** Согласие — только точная метка; dismiss (undefined) и всё прочее — отказ. */
export function acceptedAnswer(label: string | undefined): boolean {
  return label === CONFIRM_ACCEPT
}

export function appendPolicy(
  sections: readonly PromptComposeSection[],
  text: string,
): PromptComposeSection[] {
  if (sections.some(s => s.id === ANON_POLICY_ID)) {
    return [...sections]
  }
  return [...sections, { id: ANON_POLICY_ID, scope: 'session', text }]
}