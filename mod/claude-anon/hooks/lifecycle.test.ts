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
// В теле теста доступен только raisable-поднабор $; op (fs, store) — через армед-фейки.
async function makeSacrifice(
  armed: Armed,
  sessionId: string,
): Promise<{ transcriptPath: string; sessionDir: string }> {
  const tmpRoot = 'C:\\Users\\ok\\AppData\\Local\\Temp'
  const base = `claude-anon-lc-${sessionId}`
  const transcriptPath = `${tmpRoot}\\${base}.jsonl`
  const sessionDir = `${tmpRoot}\\${base}`

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