import { describe, test, expect } from 'claude-code/testing'

import { configDir, djb2Hash, isUnder, projectsDir, sanitizePath, sessionFilePaths } from './paths'

describe('sanitizePath', () => {
  test('заменяет неалфанумерные знаки на дефисы', () => {
    expect(sanitizePath('C:\\Users\\ok\\.claude')).toBe('C--Users-ok--claude')
  })

  test('короткие пути без хеша, как у каталога текущей сессии', () => {
    expect(sanitizePath('C:\\Users\\ok')).toBe('C--Users-ok')
  })

  test('путь длиннее 200 обрезается до 200 плюс хеш-суффикс', () => {
    const long = 'C:\\' + 'a'.repeat(260)
    const s = sanitizePath(long)
    expect(s.length).toBeLessThan(210)
    expect(s.startsWith(`C--${'a'.repeat(197)}`)).toBe(true)
    expect(s.endsWith(`-${Math.abs(djb2Hash(long)).toString(36)}`)).toBe(true)
  })
})

test('configDir уважает CLAUDE_CONFIG_DIR, иначе <home>\\.claude', () => {
  expect(configDir('C:\\cfg', 'C:\\Users\\ok')).toBe('C:\\cfg')
  expect(configDir(undefined, 'C:\\Users\\ok')).toBe('C:\\Users\\ok\\.claude')
})

test('projectsDir добавляет \\projects', () => {
  expect(projectsDir('C:\\cfg')).toBe('C:\\cfg\\projects')
})

test('sessionFilePaths даёт транскрипт и каталог сессии', () => {
  const p = sessionFilePaths('C:\\cfg', 'sid-1', 'C:\\Users\\ok')
  expect(p.transcriptPath).toBe('C:\\cfg\\projects\\C--Users-ok\\sid-1.jsonl')
  expect(p.sessionDir).toBe('C:\\cfg\\projects\\C--Users-ok\\sid-1')
})

test('isUnder проверяет границу каталога, а не совпадение префикса по имени', () => {
  expect(isUnder('C:\\cfg\\projects\\x\\sid.jsonl', 'C:\\cfg\\projects')).toBe(true)
  expect(isUnder('C:\\cfg\\projects-x\\file.jsonl', 'C:\\cfg\\projects')).toBe(false)
  expect(isUnder('C:\\cfg\\projects\\', 'C:\\cfg\\projects')).toBe(false)
})

test('isUnder не зависит от регистра (Windows)', () => {
  expect(isUnder('c:\\cfg\\projects\\x\\sid.jsonl', 'C:\\CFG\\projects')).toBe(true)
  expect(isUnder('C:\\cfg\\PROJECTS-x\\file.jsonl', 'C:\\cfg\\projects')).toBe(false)
})