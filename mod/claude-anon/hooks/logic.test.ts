import { describe, test, expect } from 'claude-code/testing'

import {
  ANON_POLICY_ID,
  CLEAR_ACCEPT,
  MEMORY_ATTACHMENT_TYPES,
  acceptedAnswer,
  acceptedClear,
  anonOnText,
  appendPolicy,
  bandNote,
  clearOptions,
  clearQuestion,
  confirmOptions,
  confirmQuestion,
  decideAnon,
  dropContextBlocks,
  hasPersonalBlocks,
  shouldOfferClear,
  stripMemorySections,
} from './logic'

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
    expect(d.refuseText).toContain('always incognito')
  })

  test('launcher отказывает и на голый toggle-off (Shift+Tab при включённом)', () => {
    const d = decideAnon('', true, true)
    expect(d.refuse).toBe(true)
    expect(d.refuseText).toContain('always incognito')
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

describe('confirm-баннер', () => {
  test('вопрос называет режим и главные последствия', () => {
    const q = confirmQuestion()
    expect(q).toContain('WARNING')
    expect(q).toContain('incognito')
    expect(q).toContain('transcript is deleted')
    expect(q).toContain('MEMORY.md')
    expect(q).toContain('blocked')
    expect(q).toContain('window title')
    expect(q).toContain('does not unload') // что не возвращается
  })

  test('варианты: отказ первым (default), согласие вторым', () => {
    const options = confirmOptions()
    expect(options[0]).toBe('No (default)')
    expect(options[1]).toBe('Yes, I accept')
    expect(options.length).toBe(2)
  })

  test('согласие — только точная метка; без учёта регистра и dismiss — отказ', () => {
    expect(acceptedAnswer('Yes, I accept')).toBe(true)
    expect(acceptedAnswer('yes, i accept')).toBe(false)
    expect(acceptedAnswer('No (default)')).toBe(false)
    expect(acceptedAnswer('')).toBe(false)
    // dismiss движка приходит пустотой (ui.ask в тест-движке отсутствует)
    expect(acceptedAnswer(undefined as unknown as string)).toBe(false)
  })
})

describe('bandNote', () => {
  test('launcher-режим честно обещает несохранение', () => {
    expect(bandNote(true, false)).toBe('session not saved')
    expect(bandNote(true, true)).toBe('session not saved')
  })

  test('контекст вырезан (/anon до первого хода): «memory unloaded»', () => {
    expect(bandNote(false, true)).toBe('memory unloaded')
  })

  test('включён после хода с контекстом: честное предупреждение', () => {
    expect(bandNote(false, false)).toBe('context loaded before going anon')
  })
})

describe('dropContextBlocks — чистый контекст первого хода', () => {
  test('вырезает claudeMd, userEmail, attachedProject и gitStatus', () => {
    const date = "Today's date is 2026-10-08."
    const out = dropContextBlocks([
      { name: 'claudeMd', text: 'Codebase and user instructions are shown below.' },
      { name: 'userEmail', text: 'me@example.com' },
      { name: 'attachedProject', text: 'Project Foo — path' },
      { name: 'gitStatus', text: 'branch: main' },
      { name: 'currentDate', text: date },
    ])
    expect(out).toEqual([{ name: 'currentDate', text: date }])
  })

  test('чужие блоки (плагинов и прочие) проходят', () => {
    const blocks = [
      { name: 'myplugin:thing', text: 'x' },
      { name: 'currentDate', text: 'd' },
    ]
    expect(dropContextBlocks(blocks)).toEqual(blocks)
  })

  test('пустой список — пустой ответ', () => {
    expect(dropContextBlocks([])).toEqual([])
  })
})

describe('stripMemorySections — секции памяти системного промпта', () => {
  test('вырезает memory и pronouns, прочие секции на месте', () => {
    const sections = [
      { id: 'intro', text: 'You are Claude Code', scope: 'shared' },
      { id: 'memory', text: '# Memory', scope: 'session' },
      { id: 'tone', text: 'Tone and style', scope: 'shared' },
      { id: 'pronouns', text: 'pronouns guidance', scope: 'session' },
      { id: 'language', text: 'Language: ru', scope: 'session' },
    ]
    expect(stripMemorySections(sections).map(s => s.id)).toEqual(['intro', 'tone', 'language'])
  })

  test('наша policy-секция не жертва дроп-листа', () => {
    const sections = [
      { id: 'memory', text: '# Memory', scope: 'session' },
      { id: ANON_POLICY_ID, text: 'policy', scope: 'session' },
    ]
    expect(stripMemorySections(sections).map(s => s.id)).toEqual([ANON_POLICY_ID])
  })

  test('пустой список — пустой ответ', () => {
    expect(stripMemorySections([])).toEqual([])
  })
})

describe('MEMORY_ATTACHMENT_TYPES — вложения, которые глушим при анон', () => {
  test('реколл памяти, ре-инъекция CLAUDE.md/MEMORY.md, сессия-память, team-контекст', () => {
    expect(MEMORY_ATTACHMENT_TYPES).toContain('relevant_memories')
    expect(MEMORY_ATTACHMENT_TYPES).toContain('nested_memory')
    expect(MEMORY_ATTACHMENT_TYPES).toContain('current_session_memory')
    expect(MEMORY_ATTACHMENT_TYPES).toContain('team_context')
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

describe('hasPersonalBlocks — детектор личного контекста в первом ходе', () => {
  test('claudeMd / userEmail / attachedProject / gitStatus — личное', () => {
    expect(
      hasPersonalBlocks([
        { name: 'claudeMd', text: 'Codebase and user instructions are shown below.' },
        { name: 'currentDate', text: "Today's date is 2026-10-10." },
      ]),
    ).toBe(true)
    expect(hasPersonalBlocks([{ name: 'userEmail', text: 'me@example.com' }])).toBe(true)
    expect(hasPersonalBlocks([{ name: 'attachedProject', text: 'p' }])).toBe(true)
    expect(hasPersonalBlocks([{ name: 'gitStatus', text: 'g' }])).toBe(true)
  })

  test('нейтральные блоки и пустой список — не личное', () => {
    expect(
      hasPersonalBlocks([
        { name: 'currentDate', text: 'd' },
        { name: 'myplugin:thing', text: 'x' },
      ]),
    ).toBe(false)
    expect(hasPersonalBlocks([])).toBe(false)
  })
})

describe('shouldOfferClear — когда спрашивать про /clear', () => {
  test('не-лаунчер с загрязнённым контекстом — спрашиваем', () => {
    expect(shouldOfferClear(false, true)).toBe(true)
  })

  test('лаунчер не спрашивает никогда; чистый контекст — тоже', () => {
    expect(shouldOfferClear(true, true)).toBe(false)
    expect(shouldOfferClear(true, false)).toBe(false)
    expect(shouldOfferClear(false, false)).toBe(false)
  })
})

describe('clear-диалог', () => {
  test('вопрос честно называет память и /clear', () => {
    const q = clearQuestion()
    expect(q).toContain('memory')
    expect(q).toContain('/clear')
    expect(q).toContain('cannot be unloaded')
  })

  test('варианты: отказ первым (default), очистка второй', () => {
    const options = clearOptions()
    expect(options[0]).toBe('Keep (default)')
    expect(options[1]).toBe(CLEAR_ACCEPT)
    expect(options.length).toBe(2)
  })

  test('согласие — только точная метка; dismiss — отказ', () => {
    expect(acceptedClear(CLEAR_ACCEPT)).toBe(true)
    expect(acceptedClear('clear conversation')).toBe(false)
    expect(acceptedClear('Keep (default)')).toBe(false)
    expect(acceptedClear(undefined)).toBe(false)
  })
})

describe('anonOnText — текст результата /anon on', () => {
  test('чистое включение — базовый текст без упоминания /clear', () => {
    const t = anonOnText('clean')
    expect(t).toBe('claude anon on — the session will not be saved, memory writes are blocked.')
  })

  test('контекст остался (' + 'kept' + ') — честно зовёт в /clear', () => {
    const t = anonOnText('kept')
    expect(t).toContain('will not be saved')
    expect(t).toContain('/clear')
  })

  test('очистка поставлена (scheduled) — сообщает о ней', () => {
    expect(anonOnText('scheduled')).toContain('clearing')
  })

  test('часов нет (manual) — просит запустить /clear руками', () => {
    const t = anonOnText('manual')
    expect(t).toContain('run /clear yourself')
  })
})