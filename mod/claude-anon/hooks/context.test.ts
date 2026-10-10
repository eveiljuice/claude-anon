// Register-уровень: метка tainted на безфильтровую композицию контекста,
// /clear-предложение при включении с уже загруженным личным контекстом.
import { test, expect } from 'claude-code/testing'
import { TEST_SESSION_ID, armEngineOps, armLifecycle, armPromptContext } from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

const PERSONAL = [
  { name: 'claudeMd', text: 'Codebase and user instructions are shown below.\n\nContents of MEMORY.md…' },
  { name: 'currentDate', text: "Today's date is 2026-10-10." },
]
const NEUTRAL = [{ name: 'currentDate', text: "Today's date is 2026-10-10." }]

test('prompt.context без анона с личными блоками метит tainted', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armPromptContext(on)

  const res = await $.prompt.context({ blocks: PERSONAL, instructionFiles: [] })

  expect(res.blocks.length).toBe(PERSONAL.length) // без анона ничего не режется
  expect(armed.state.get('anon-mode/contextTainted')).toBe(true)
})

test('prompt.context без анона с нейтральными блоками не метит', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armPromptContext(on)

  await $.prompt.context({ blocks: NEUTRAL, instructionFiles: [] })

  expect(armed.state.get('anon-mode/contextTainted')).not.toBe(true)
})

test('prompt.context при включённом аноне режет блоки и не метит', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armPromptContext(on)
  await $.command.run(RUN('on'))

  const res = await $.prompt.context({
    blocks: PERSONAL,
    instructionFiles: [{ path: 'C:\\Users\\ok\\MEMORY.md', kind: 'memory', content: 'x' }],
  })

  expect(res.blocks.map(b => b.name)).toEqual(['currentDate'])
  // «файлов за claudeMd нет» у движка — undefined, не пустой массив
  expect((res.instructionFiles ?? []).length).toBe(0)
  expect(armed.state.get('anon-mode/contextUnloaded')).toBe(true)
  expect(armed.state.get('anon-mode/contextTainted')).not.toBe(true)
})

test('/anon on при tainted зовёт в /clear (диалог в тест-движке отклоняется — kept)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armPromptContext(on)
  await $.prompt.context({ blocks: PERSONAL, instructionFiles: [] }) // загрязнение до включения

  const res = await $.command.run(RUN('on'))

  expect(res.text).toContain('/clear')
  expect(armed.state.get('anon-mode/anonOn')).toBe(true)
})

test('/anon on без tainted — базовый текст без /clear', { timeoutMs: 15000 }, async ($, on) => {
  armEngineOps(on)
  armPromptContext(on)

  const res = await $.command.run(RUN('on'))

  expect(res.text).toBe('claude anon on — the session will not be saved, memory writes are blocked.')
})

test('/anon on в лаунчер-профиле не предлагает /clear даже при tainted', { timeoutMs: 15000 }, async ($, on) => {
  armEngineOps(on, { env: { CLAUDE_ANON: '1', USERPROFILE: 'C:\\Users\\ok', TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp' } })
  armPromptContext(on)
  armLifecycle(on)
  await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true }) // launcher → anonOn
  // гипотетическая метка (не должна влиять на лаунчер)
  await $.prompt.context({ blocks: PERSONAL, instructionFiles: [] })

  const res = await $.command.run(RUN('on'))

  expect(res.text).not.toContain('/clear')
})

test('/clear снимает tainted: новая беседа начинается чистой', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armPromptContext(on)
  armLifecycle(on)
  await $.prompt.context({ blocks: PERSONAL, instructionFiles: [] }) // tainted = true
  expect(armed.state.get('anon-mode/contextTainted')).toBe(true)

  await $.session.end({ reason: 'clear', sessionId: TEST_SESSION_ID, resume: { id: TEST_SESSION_ID } })

  expect(armed.state.get('anon-mode/contextTainted')).toBe(false)
})
