import { describe, test, expect } from 'claude-code/testing'

import { ANON_POLICY_ID, appendPolicy, bandNote, decideAnon } from './logic'

describe('decideAnon', () => {
  test('голая /anon — toggle', () => {
    expect(decideAnon('', false, false)).toEqual({ want: true, refuse: false, refuseText: '' })
    expect(decideAnon('', true, false)).toEqual({ want: false, refuse: false, refuseText: '' })
  })

  test('case-fold и пробелы: ON, off, " off "', () => {
    expect(decideAnon('ON', false, false).want).toBe(true)
    expect(decideAnon(' off', true, false).want).toBe(false)
    expect(decideAnon('OFF ', true, false).want).toBe(false)
  })

  test('неизвестное слово считается toggle (Review Focus 5)', () => {
    expect(decideAnon('bogus', false, false).want).toBe(true)
    expect(decideAnon('  ', true, false).want).toBe(false)
  })

  test('launcher отказывает off, когда режим включён', () => {
    const d = decideAnon('off', true, true)
    expect(d.refuse).toBe(true)
    expect(d.refuseText).toContain('инкогнито всегда')
  })

  test('launcher безвреден для on', () => {
    expect(decideAnon('on', true, true).refuse).toBe(false)
  })

  test('non-launcher off не отказывает', () => {
    const d = decideAnon('off', true, false)
    expect(d.refuse).toBe(false)
    expect(d.want).toBe(false)
  })
})

describe('bandNote', () => {
  test('launcher-режим честно обещает несохранение', () => {
    expect(bandNote(true)).toBe('сессия не сохранится')
  })

  test('mid-session-режим предупреждает о уже загруженном контексте', () => {
    expect(bandNote(false)).toBe('контекст уже загружен')
  })
})

describe('appendPolicy', () => {
  test('добавляет секцию в конец с session-scope', () => {
    const out = appendPolicy([{ id: 'tone', text: 'быть полезным', scope: 'shared' }], 'правила')
    expect(out.length).toBe(2)
    const last = out[1]
    expect(last.id).toBe(ANON_POLICY_ID)
    expect(last.scope).toBe('session')
    expect(last.text).toBe('правила')
  })

  test('идемпотентна: вторая попытка не дублирует', () => {
    const once = appendPolicy([], 'правила')
    expect(appendPolicy(once, 'правила').length).toBe(1)
  })
})