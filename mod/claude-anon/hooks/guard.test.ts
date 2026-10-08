import { test, expect } from 'claude-code/testing'
import { armBottomTools, armEngineOps, armPromptCompose } from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

// Полный вход композиции: движок требует model, promptModel, surfaces, tools,
// outputStyle (null — дефолтный стиль), traits.
const COMPOSE = {
  model: 'test-model',
  promptModel: 'test-model',
  surfaces: ['terminal'] as const,
  tools: [],
  outputStyle: null,
  traits: [],
} as const

// Уровень hook'а denial приходит как `{ deny }` (иногда с core-штампом `.text`
// для классических оболочек); читаем оба.
const DENIED = async (result: unknown): Promise<boolean> => {
  const shape = result as { deny?: string; text?: string } | undefined
  return String(shape?.deny ?? shape?.text ?? '').includes('claude anon')
}

test('Write под <CFG>/projects отказан при on (Review Focus 2)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armBottomTools(on)
  armed.fsDirs.add('C:\\Users\\ok\\.claude\\projects\\C--Users-ok')
  await $.command.run(RUN('on'))

  // файл под существующим каталогом проекта: folder-фолбэк резолвит внутрь
  const result = await $.tool.call({
    tool: 'Write',
    file_path: 'C:\\Users\\ok\\.claude\\projects\\C--Users-ok\\some-session.jsonl',
    content: 'привет, память!',
  })
  expect(await DENIED(result)).toBe(true)
})

test('Write под projects в НЕ-resolvable каталог — тоже отказан (fail-closed)', { timeoutMs: 15000 }, async ($, on) => {
  armEngineOps(on)
  armBottomTools(on)
  await $.command.run(RUN('on'))

  const result = await $.tool.call({
    tool: 'Write',
    file_path: 'C:\\Users\\ok\\.claude\\projects\\C--Users-ok\\whatever\\subagents\\probe.md',
    content: 'привет, память!',
  })
  expect(await DENIED(result)).toBe(true)
})

test('Write вне projects проходит при on', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armBottomTools(on)
  await $.command.run(RUN('on'))

  const result = await $.tool.call({
    tool: 'Write',
    file_path: 'C:\\Users\\ok\\tmp-anon-mode-test\\guard-allowed.txt',
    content: 'ok',
  })
  expect(await DENIED(result)).toBe(false)
  // чистки (cmd del/rd) из теста не было — powershell-спавны заголовка допустимы
  expect(armed.argvs.filter(argv => argv[0] === 'cmd' && argv[2] !== 'title')).toEqual([])
})

test('гвардия не зависит от регистра корня и пути (I3)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on, {
    env: { USERPROFILE: 'C:\\USERS\\OK', TEMP: 'C:\\USERS\\OK\\AppData\\Local\\Temp' },
  })
  armBottomTools(on)
  // путь spelled нижним регистром, корень — верхним: сравнение обязано совпасть
  armed.fsFiles.set('c:\\users\\ok\\.claude\\projects\\c--users-ok\\some-session.jsonl', '{}')
  await $.command.run(RUN('on'))

  const result = await $.tool.call({
    tool: 'Write',
    file_path: 'c:\\users\\ok\\.claude\\projects\\c--users-ok\\some-session.jsonl',
    content: 'x',
  })
  expect(await DENIED(result)).toBe(true)
})

test('Edit под <CFG>/projects отказан при on и свободен при off', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armBottomTools(on)
  armed.fsFiles.set('C:\\Users\\ok\\.claude\\projects\\C--Users-ok\\some-session.jsonl', '{}')
  await $.command.run(RUN('on'))

  const denied = await $.tool.call({
    tool: 'Edit',
    file_path: 'C:\\Users\\ok\\.claude\\projects\\C--Users-ok\\some-session.jsonl',
    old_string: 'a',
    new_string: 'b',
  })
  expect(await DENIED(denied)).toBe(true)

  await $.command.run(RUN('off'))
  const allowed = await $.tool.call({
    tool: 'Edit',
    file_path: 'C:\\Users\\ok\\.claude\\projects\\C--Users-ok\\some-session.jsonl',
    old_string: 'a',
    new_string: 'b',
  })
  expect(await DENIED(allowed)).toBe(false) // гвардия пропустила: deny-текста нет
})

test('prompt.compose при on добавляет секцию политики один раз (в конец)', { timeoutMs: 15000 }, async ($, on) => {
  armEngineOps(on)
  armPromptCompose(on)
  await $.command.run(RUN('on'))

  const composed = (await $.prompt.compose(COMPOSE)) as { sections?: { id: string; scope: string; text: string }[] }
  const mine = (composed.sections ?? []).filter(s => s.id === 'anon-mode:policy')
  expect(mine.length).toBe(1)
  expect(mine[0].id).toBe('anon-mode:policy')
  expect(mine[0].scope).toBe('session')
  expect(composed.sections?.at(-1)?.id).toBe('anon-mode:policy')
})

test('prompt.compose при off не трогает секции', { timeoutMs: 15000 }, async ($, on) => {
  armEngineOps(on)
  armPromptCompose(on)
  await $.command.run(RUN('on'))
  await $.command.run(RUN('off'))

  const composed = (await $.prompt.compose(COMPOSE)) as { sections?: { id: string }[] }
  expect((composed.sections ?? []).some(s => s.id === 'anon-mode:policy')).toBe(false)
})