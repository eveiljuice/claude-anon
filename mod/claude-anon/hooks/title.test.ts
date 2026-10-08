import { describe, test, expect } from 'claude-code/testing'

import { ANON_TITLE, psQuote, readTitleArgv, restoreTitleArgv, setTitleArgv } from './title'

describe('psQuote', () => {
  test('оборачивает в апострофы', () => {
    expect(psQuote('Claude Code Anon')).toBe("'Claude Code Anon'")
  })

  test('экранирует апострофы удвоением', () => {
    expect(psQuote("anon'99")).toBe("'anon''99'")
  })
})

describe('argv-конструкторы', () => {
  test('setTitleArgv — powershell RawUI с кавычками', () => {
    expect(setTitleArgv(ANON_TITLE)).toEqual([
      'powershell',
      '-NoProfile',
      '-Command',
      "$Host.UI.RawUI.WindowTitle='Claude Code Anon'",
    ])
  })

  test('readTitleArgv — powershell читает то же поле', () => {
    expect(readTitleArgv()).toEqual([
      'powershell',
      '-NoProfile',
      '-Command',
      '$Host.UI.RawUI.WindowTitle',
    ])
  })

  test('restoreTitleArgv — быстрый cmd-title для бюджета session.end', () => {
    expect(restoreTitleArgv('Claude Code')).toEqual(['cmd', '/c', 'title', 'Claude Code'])
  })
})