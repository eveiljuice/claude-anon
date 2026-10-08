// Чистая логика режима claude anon — без движковых вызовов, только правила.
import type { PromptComposeSection } from 'claude-code'

export type AnonDecision = {
  want: boolean
  refuse: boolean
  refuseText: string
}

export const ANON_POLICY_ID = 'anon-mode:policy'

export const BAND_SUFFIX = 'memory writes blocked'

export function decideAnon(arg: string, current: boolean, launcher: boolean): AnonDecision {
  const spoken = arg.trim().toLowerCase()

  if (spoken === 'off' && launcher && current) {
    return {
      want: false,
      refuse: true,
      refuseText: 'claude anon: this profile is always incognito',
    }
  }
  if (spoken === 'on') {
    return { want: true, refuse: false, refuseText: '' }
  }
  if (spoken === 'off') {
    return { want: false, refuse: false, refuseText: '' }
  }
  return { want: !current, refuse: false, refuseText: '' }
}

export function bandNote(launcher: boolean): string {
  return launcher ? 'session not saved' : 'context loaded before going anon'
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