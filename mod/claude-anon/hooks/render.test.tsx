import { describe, test, expect } from 'claude-code/testing'
import { armEngineOps, armNativeRender } from './test-support'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 24,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
} as const

const SURVEY_PROPS = { ...BAND_PROPS, hasSurvey: true } as const

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

describe('band (AbovePrompt)', () => {
  test('рисуется при on и исчезает при off', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await $.command.run(RUN('on'))
    await ui.redraw() // редроу идёт по draw-rate движка — тест проматывает его явно
    let rows = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(rows.length).toBeGreaterThanOrEqual(1)

    await $.command.run(RUN('off'))
    await ui.redraw()
    rows = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(rows).toEqual([])
  })

  test('band на desktop рисуется без ошибок таблицы элементов', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'desktop',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await $.command.run(RUN('on'))
    await ui.redraw()
    const rows = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  test('уступает опросу: hasSurvey — band пуст (Review Focus 3)', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: SURVEY_PROPS,
    })

    await $.command.run(RUN('on'))
    const rows = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(rows).toEqual([])
  })

  test('mid-session честен: bandNote(false) — «context loaded before going anon»', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })

    await $.command.run(RUN('on'))
    await ui.redraw()
    const rows = await ui.findAll({ type: 'Text', text: 'context loaded before going anon' })
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })
})

describe('заметка под полем ввода (PromptHint.tail)', () => {
  test('заметка дописывается к нативному хинту при toggle on', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })

    await $.command.run(RUN('on'))
    await ui.redraw()

    const notice = await ui.findAll({ type: 'Text', text: 'session will not be saved' })
    expect(notice.length).toBeGreaterThanOrEqual(1)
    const native = await ui.findAll({ type: 'Text', text: 'for shortcuts' })
    expect(native.length).toBeGreaterThanOrEqual(1)
  })

  test('без заметки нативный хинт не тронут, тосты-в-угол не спавнятся', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    armNativeRender(on)
    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })

    await ui.redraw()
    const rows = await ui.findAll({ type: 'Text', text: 'claude anon on' })
    expect(rows).toEqual([])
    expect(armed.toasts).toEqual([]) // тосты больше не используются
  })
})

describe('лейбл футера (SessionMode)', () => {
  test('при on нативный ряд остаётся, лейбл добавляется', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    await $.command.run(RUN('on'))

    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })

    const label = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(label.length).toBeGreaterThanOrEqual(1)
    const native = await ui.findAll({ type: 'Text', text: 'focus' })
    expect(native.length).toBeGreaterThanOrEqual(1)
  })

  test('при off SessionMode untouched', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armNativeRender(on)
    await $.command.run(RUN('off'))

    const ui = await $.ui.mount({
      plugin: 'anon-mode',
      surface: 'terminal',
      component: 'SessionMode',
      props: { modes: ['focus'] },
    })

    const label = await ui.findAll({ type: 'Text', text: 'claude anon' })
    expect(label).toEqual([])
  })
})