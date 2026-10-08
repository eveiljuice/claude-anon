// Мунгинг путей проекта — зеркало движкового кода (sessionStoragePortable.ts),
// чтобы мод вычислял те же каталоги, что пишет движок.

const MAX_SANITIZED_LENGTH = 200

export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  // Движок для таких путей может взять Bun.hash; расхождение тогда гасится
  // тем, что в манифесте хранятся абсолютные пути, снятые при включении
  // (см. register.tsx), — чистка не пересчитывает munged-имя.
  const hash = Math.abs(djb2Hash(name)).toString(36)
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`
}

export function configDir(
  claudeConfigDir: string | undefined,
  userProfile: string | undefined,
): string {
  if (claudeConfigDir !== undefined && claudeConfigDir !== '') {
    return claudeConfigDir
  }
  const home = userProfile ?? ''
  return home === '' ? '.claude' : `${home}\\.claude`
}

export function projectsDir(configRoot: string): string {
  return `${configRoot}\\projects`
}

export function sessionFilePaths(
  configRoot: string,
  sessionId: string,
  cwdReal: string,
): { transcriptPath: string; sessionDir: string } {
  const projectDir = `${projectsDir(configRoot)}\\${sanitizePath(cwdReal)}`
  return {
    transcriptPath: `${projectDir}\\${sessionId}.jsonl`,
    // Вся папка сессии: rd /s /q по ней снимет и subagents/, и сам каталог.
    sessionDir: `${projectDir}\\${sessionId}`,
  }
}

export function isUnder(path: string, dir: string): boolean {
  const withSep = dir.endsWith('\\') || dir.endsWith('/') ? dir : `${dir}\\`
  // Каталог сам по себе (равно или с завершающим разделителем) — не «внутри».
  return path.startsWith(withSep) && path !== dir && path !== withSep
}