// Заголовок окна терминала через спавн: SetConsoleTitle меняет заголовок
// общей консоли/вкладки Windows Terminal (спека §3.2). Чтение и аккуратная
// установка — powershell; восстановление — cmd title (бюджет session.end 1.5с).
export const ANON_TITLE = 'Claude Code Anon'

export function psQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`
}

export function readTitleArgv(): string[] {
  return ['powershell', '-NoProfile', '-Command', '$Host.UI.RawUI.WindowTitle']
}

export function setTitleArgv(title: string): string[] {
  return [
    'powershell',
    '-NoProfile',
    '-Command',
    `$Host.UI.RawUI.WindowTitle=${psQuote(title)}`,
  ]
}

export function restoreTitleArgv(title: string): string[] {
  return title === '' ? [] : ['cmd', '/c', 'title', title]
}