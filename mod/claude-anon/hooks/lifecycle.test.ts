import { test, expect } from 'claude-code/testing'
import type { AnonManifest, ManifestRecord } from './register'
import { TEST_SESSION_ID, armEngineOps, armLifecycle, type Armed } from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

// Готовит «жертву» в фейковом fs: transcript-файл + каталог сессии, запись в манифест.
// Жертва живёт ПОД каталогом projects — контейнмент удаляет только из него.
async function makeSacrifice(
  armed: Armed,
  sessionId: string,
): Promise<{ transcriptPath: string; sessionDir: string }> {
  const root = 'C:\\Users\\ok\\.claude\\projects\\C--Users-ok-tmp-anon-mode-test'
  const base = `${root}\\claude-anon-lc-${sessionId}`
  const transcriptPath = `${base}.jsonl`
  const sessionDir = `${base}`

  armed.fsFiles.set(transcriptPath, '{"type":"user"}') // фейк-фс: файл
  armed.fsDirs.add(sessionDir) // фейк-фс: каталог сессии (как у движка)

  armed.store.set('anon-manifest', {
    [sessionId]: { transcriptPath, sessionDir } as ManifestRecord,
  })
  return { transcriptPath, sessionDir }
}

test('session.end удаляет транскрипт и снимает запись', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const sessionId = TEST_SESSION_ID
  const sacrifice = await makeSacrifice(armed, sessionId)
  await $.command.run(RUN('on')) // sticky: on ставит запись; перезапишем нашей
  armed.store.set('anon-manifest', {
    [sessionId]: { transcriptPath: sacrifice.transcriptPath, sessionDir: sacrifice.sessionDir },
  })
  armed.argvs.length = 0

  await $.session.end({ reason: 'prompt_input_exit', sessionId, resume: { id: sessionId } })

  expect(armed.argvs).toEqual([
    ['cmd', '/c', 'del', '/q', '/f', sacrifice.transcriptPath],
    ['cmd', '/c', 'rd', '/s', '/q', sacrifice.sessionDir],
  ])

  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(manifest)).not.toContain(sessionId)
})

test('/clear снимает запись старого id (перенос на новый — вне теста)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const oldId = TEST_SESSION_ID
  await $.command.run(RUN('on')) // sticky-запись старого id
  expect(Object.keys(armed.store.get('anon-manifest') as AnonManifest).length).toBe(1)

  await $.session.end({ reason: 'clear', sessionId: oldId, resume: { id: oldId } })

  // Тестовый движок не выпускает новый id, поэтому ветка переноса не сработает;
  // детерминированная часть — запись старого id снята, файлы убраны best effort.
  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(manifest)).not.toContain(oldId)
})

test('сироты дочищиваются при session.start (Review Focus 1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const orphanId = 'orphan-test-0001'
  const orphan = await makeSacrifice(armed, orphanId)
  armed.argvs.length = 0

  await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })

  expect(armed.argvs).toContainEqual(['cmd', '/c', 'del', '/q', '/f', orphan.transcriptPath])
  expect(armed.argvs).toContainEqual(['cmd', '/c', 'rd', '/s', '/q', orphan.sessionDir])

  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(manifest)).not.toContain(orphanId)
})

test('текущая сессия при сёрче не тронута', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const currentId = TEST_SESSION_ID
  await $.command.run(RUN('on'))
  const before = armed.store.get('anon-manifest') as AnonManifest
  armed.argvs.length = 0

  await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })

  expect(armed.argvs).toEqual([]) // ничего не удалялось
  const after = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(after)).toContain(currentId)
  expect(after[currentId].transcriptPath).toBe(before[currentId].transcriptPath)
})

// --- финальное ревью: C1, I1, I2, M3 ---

/** Транскрипт, который recordOwnSession посчитает для TEST_SESSION_ID (ARM cwd/config). */
const EXPECTED_OWN_TRANSCRIPT = (): string =>
  'C:\\Users\\ok\\.claude\\projects\\C--Users-ok-tmp-anon-mode-test\\' + `${TEST_SESSION_ID}.jsonl`

/** Каталог сессии, который recordOwnSession посчитает для TEST_SESSION_ID. */
const EXPECTED_OWN_SESSION_DIR = (): string =>
  'C:\\Users\\ok\\.claude\\projects\\C--Users-ok-tmp-anon-mode-test\\' + TEST_SESSION_ID

test('/clear ставит флаг продолжения и снимает запись старого id (C1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const oldId = TEST_SESSION_ID
  await $.command.run(RUN('on'))
  armed.argvs.length = 0

  await $.session.end({ reason: 'clear', sessionId: oldId, resume: { id: oldId } })

  expect(armed.store.get('anon-continue')).toBe(true)
  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(manifest)).not.toContain(oldId)
})

test('session.end после /clear записывает и удаляет свой транскрипт, флаг снят (C1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const id = TEST_SESSION_ID
  await $.command.run(RUN('on'))
  await $.session.end({ reason: 'clear', sessionId: id, resume: { id } }) // флаг продолжения
  armed.argvs.length = 0
  armed.store.delete('anon-manifest') // пост-клировский манифест — без записей
  armed.store.set('anon-continue', true) // state мог быть сброшен; флаг управляет
  // пост-клировская беседа успела поработать: её транскрипт существует
  armed.fsFiles.set(EXPECTED_OWN_TRANSCRIPT(), '{"type":"user"}')
  armed.fsDirs.add(EXPECTED_OWN_SESSION_DIR())

  await $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: { id } })

  expect(armed.argvs).toContainEqual(['cmd', '/c', 'del', '/q', '/f', EXPECTED_OWN_TRANSCRIPT()])
  expect(armed.store.get('anon-continue')).toBeUndefined()
  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(Object.keys(manifest)).not.toContain(id)
})

test('/anon off после /clear отменяет отложенное удаление (C1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const id = TEST_SESSION_ID
  await $.command.run(RUN('on'))
  await $.session.end({ reason: 'clear', sessionId: id, resume: { id } }) // флаг
  await $.command.run(RUN('off')) // явное выключение в пост-клире отменяет
  expect(armed.store.get('anon-continue')).toBeUndefined()

  armed.argvs.length = 0
  await $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: { id } })
  expect(armed.argvs.some(argv => argv[0] === 'cmd')).toBe(false)
})

test('session.start перевооружает анон для записи своего id (resume, M3)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  armed.store.set('anon-manifest', {
    [TEST_SESSION_ID]: { transcriptPath: 'C:\\x.jsonl', sessionDir: 'C:\\x' },
  })

  await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })

  expect(armed.state.get('anon-mode/anonOn')).toBe(true)
})

test('session.start глотает флаг продолжения, не перевооружая (свежий процесс, C1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  armed.store.set('anon-continue', true)

  await $.session.start({ cwd: 'C:\\Users\\ok', surface: 'terminal', isInteractive: true })

  expect(armed.state.get('anon-mode/anonOn')).toBeUndefined()
  expect(armed.store.get('anon-continue')).toBeUndefined()
})

test('неудача удаления (exitCode 1) оставляет запись в манифесте (I1)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on, { processExitCode: 1 })
  armLifecycle(on)
  const id = TEST_SESSION_ID
  const sacrifice = await makeSacrifice(armed, id)
  armed.argvs.length = 0

  await $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: { id } })

  expect(armed.argvs).toContainEqual(['cmd', '/c', 'del', '/q', '/f', sacrifice.transcriptPath])
  const manifest = armed.store.get('anon-manifest') as AnonManifest
  expect(manifest[id]).toBeDefined() // запись осталась — ретрай на следующем старте
})

test('запись с путём вне projects не удаляется и остаётся (контейнмент, I2)', { timeoutMs: 15000 }, async ($, on) => {
  const armed = armEngineOps(on)
  armLifecycle(on)
  const id = TEST_SESSION_ID
  const evil = 'C:\\Users\\ok\\Desktop\\victim.jsonl'
  armed.fsFiles.set(evil, 'victim content')
  const evilRec = { transcriptPath: evil, sessionDir: 'C:\\Users\\ok\\Desktop\\victim-dir' }
  armed.store.set('anon-manifest', { [id]: evilRec })

  await $.session.end({ reason: 'prompt_input_exit', sessionId: id, resume: { id } })

  expect(armed.argvs.some(argv => argv.includes(evil))).toBe(false)
  expect(armed.store.get('anon-manifest') as AnonManifest).toEqual({ [id]: evilRec })
})