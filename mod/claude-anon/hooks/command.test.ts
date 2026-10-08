import { describe, test, expect } from 'claude-code/testing'
import type { AnonManifest } from './register'
import { TEST_SESSION_ID, armEngineOps, armLifecycle } from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

describe('/anon toggle', () => {
  test('голая /anon включает и пишет манифест', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    const answer = await $.command.run(RUN(''))

    expect(answer.text).toContain('on')
    expect(armed.state.get('anon-mode/notice')).toBe('claude anon on — session will not be saved')

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    const ids = Object.keys(manifest)
    expect(ids.length).toBe(1)

    const rec = manifest[ids[0]]
    expect(rec.transcriptPath).toContain('\\projects\\')
    expect(rec.transcriptPath.endsWith('.jsonl')).toBe(true)
    expect(rec.sessionDir.endsWith('\\' + ids[0])).toBe(true)
    expect(ids[0]).toBe('test-session-anon')
  })

  test('sticky off: off не снимает запись манифеста (Review Focus 4)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    await $.command.run(RUN('on'))
    await $.command.run(RUN('off'))

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    expect(Object.keys(manifest).length).toBe(1)
  })

  test('повторный on не плодит записи манифеста', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    await $.command.run(RUN('on'))
    await $.command.run(RUN('on'))

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    expect(Object.keys(manifest).length).toBe(1)
  })
})

describe('confirm-баннер перед включением', () => {
  test('seen-флаг: включение без диалога (согласие между сессиями)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    const answer = await $.command.run(RUN(''))

    expect(answer.text).toContain('on')
    expect(armed.state.get('anon-mode/anonOn')).toBe(true)
    // запись манифеста появляется после согласия (оно уже было)
    expect((armed.store.get('anon-manifest') as AnonManifest)[TEST_SESSION_ID]).toBeDefined()
  })

  test('без согласия (в тест-движке ask недоступен) — declined, ничего не меняется', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on, { consent: false })
    const answer = await $.command.run(RUN(''))

    // В тест-движке $.ui.ask не существует — dialog ask невозможен, согласия нет:
    // fail-closed. Реальный движок здесь показывает диалог (модульные тесты
    // logic.test.ts покрывают вопрос и точное слово согласия).
    expect(answer.text).toContain('left off')
    expect(armed.state.get('anon-mode/anonOn')).toBeUndefined()
    expect(armed.store.get('anon-manifest')).toBeUndefined()
    expect(armed.store.get('anon-confirm-seen')).toBeUndefined()
  })

  test('явный off без согласия разрешён (баннер только для включения)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on, { consent: false })
    const answer = await $.command.run(RUN('off'))

    expect(answer.text).toContain('off')
    expect(armed.state.get('anon-mode/anonOn')).toBe(false)
  })

  test('согласие запомнено в $.store и живёт сквозь toggle туда-обратно', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    await $.command.run(RUN('on'))
    await $.command.run(RUN('off'))
    await $.command.run(RUN(''))

    expect(armed.store.get('anon-confirm-seen')).toBe(true) // не стирается off-ом
    expect(armed.state.get('anon-mode/anonOn')).toBe(true)
  })

  test('launcher: голый toggle-off отказывает (Shift+Tab при всегда-инкогнито)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on, {
      env: {
        USERPROFILE: 'C:\\Users\\ok',
        TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp',
        CLAUDE_ANON: '1',
      },
    })
    armLifecycle(on)
    await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })
    armed.argvs.length = 0

    const answer = await $.command.run(RUN(''))

    expect(answer.text).toContain('always incognito')
    expect(armed.state.get('anon-mode/anonOn')).toBe(true) // не выключился
  })

  test('launcher: явный on — без согласования и без записи манифеста дублем', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on, {
      env: {
        USERPROFILE: 'C:\\Users\\ok',
        TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp',
        CLAUDE_ANON: '1',
      },
    })
    armLifecycle(on)
    await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })

    const answer = await $.command.run(RUN('on'))

    expect(answer.text).toContain('on')
    // Launcher запись манифеста не пишет вовсе: current уже true, confirm-путь не берётся
    expect(armed.store.get('anon-manifest')).toBeUndefined()
  })
})