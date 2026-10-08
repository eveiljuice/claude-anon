// claude anon — инкогнито-режим: чистый контекст, сессия не сохраняется,
// память не пишется, телеметрию глушит лаунчер; клиент красится в фиолетовый.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { BAND_SUFFIX, appendPolicy, bandNote, decideAnon } from './logic'
import { configDir, isUnder, projectsDir, sessionFilePaths } from './paths'
import { ANON_TITLE, readTitleArgv, restoreTitleArgv, setTitleArgv } from './title'

const MANIFEST_KEY = 'anon-manifest'

const ANON_POLICY_TEXT =
  'claude anon включён: не пиши в память (MEMORY.md и файлы автопамяти), ' +
  'не ссылайся на память пользователя, CLAUDE.md или историю подсказок — ' +
  'они в этой сессии не загружались — и не персонализируй ответы.'

const ANON_DENY_MESSAGE = 'claude anon: запись под каталогом проектных сессий заблокирована'

export type ManifestRecord = { transcriptPath: string; sessionDir: string }
export type AnonManifest = Record<string, ManifestRecord>

const anonOn = atom({ plugin: 'anon-mode', key: 'anonOn' } as const, false)
const launcherMode = atom({ plugin: 'anon-mode', key: 'launcherMode' } as const, false)

// --- палитра (спека §3.2) ---
const ANON_BG = '#4b2e83'
const ANON_FG = '#f2ecff'
const ANON_ACCENT = '#b98cff'
const ANON_MASKOT = '#9b6bff'
const MASKOT = '◉‿◉'

const restoredTitle = atom({ plugin: 'anon-mode', key: 'restoredTitle' } as const, null)

// Структурный поднабор $, которого достаточно хелперам: полный Engine
// структурно совместим с ним, типы не зависят от выписанных движком d.ts.
type EngineSubset = {
  session: {
    id: () => Promise<string>
    cwd: () => Promise<string>
  }
  env: {
    get: (name: string) => Promise<string | undefined>
  }
  fs: {
    exists: (path: string) => Promise<boolean>
    stat: (path: string, options?: { resolve?: boolean }) => Promise<{ realPath?: string }>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
  process: {
    run: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
}

async function configRoot($: EngineSubset): Promise<string> {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('USERPROFILE')
  return configDir(cfg, home)
}

async function cwdReal($: EngineSubset): Promise<string> {
  const cwd = await $.session.cwd()
  const stat = await $.fs.stat(cwd, { resolve: true }).catch(() => undefined)
  return stat?.realPath ?? cwd
}

async function readManifest($: EngineSubset): Promise<AnonManifest> {
  const held = await $.store.get(MANIFEST_KEY)
  return held === undefined || held === null ? {} : (held as AnonManifest)
}

/** Удаляет файлы записи; отсутствующее на диске проходит тихо (best effort). */
async function deleteQuietly($: EngineSubset, rec: ManifestRecord): Promise<void> {
  if (await $.fs.exists(rec.transcriptPath)) {
    await $.process.run(['cmd', '/c', 'del', '/q', '/f', rec.transcriptPath])
  }
  if (await $.fs.exists(rec.sessionDir)) {
    await $.process.run(['cmd', '/c', 'rd', '/s', '/q', rec.sessionDir])
  }
}

/** Удаляет файлы записи и снимает её. */
async function dropManifestEntry($: EngineSubset, sessionId: string): Promise<void> {
  const manifest = await readManifest($)
  const rec = manifest[sessionId]
  if (rec === undefined) {
    return
  }
  await deleteQuietly($, rec)
  const next: AnonManifest = { ...manifest }
  delete next[sessionId]
  await $.store.set(MANIFEST_KEY, next)
}

/** Дочистка сирот после хард-килла: чужие записи удаляем, свою оставляем. */
async function sweepOrphans($: EngineSubset): Promise<void> {
  const manifest = await readManifest($)
  const current = await $.session.id()
  const keep: AnonManifest = {}
  let changed = false
  for (const id of Object.keys(manifest)) {
    if (id === current) {
      keep[id] = manifest[id]
      continue
    }
    await deleteQuietly($, manifest[id])
    changed = true
  }
  if (changed) {
    await $.store.set(MANIFEST_KEY, keep)
  }
}

/** Читает прежний заголовок один раз; пустота — тоже легитимное запомненное. */
async function saveTitleIfUnsaved($: EngineSubset): Promise<void> {
  const existing = await read($, restoredTitle)
  if (existing !== null) {
    return
  }
  const { stdout } = await $.process.run(readTitleArgv())
  const held = stdout === undefined ? '' : stdout.trim()
  await update($, restoredTitle, () => held)
}

/** Возвращает прежний заголовок (быстрый cmd-title — бюджет session.end 1.5с). */
async function restoreTitleNow($: EngineSubset): Promise<void> {
  const saved = await read($, restoredTitle)
  if (saved === null) {
    return
  }
  await update($, restoredTitle, () => null)
  if (saved === '') {
    return
  }
  try {
    await $.process.run(restoreTitleArgv(saved))
  } catch {
    /* окно могло закрыться */
  }
}

async function recordOwnSession($: EngineSubset): Promise<void> {
  const sessionId = await $.session.id()
  if (sessionId === '') {
    return
  }
  const config = await configRoot($)
  const real = await cwdReal($)
  const paths = sessionFilePaths(config, sessionId, real)
  const manifest = await readManifest($)
  await $.store.set(MANIFEST_KEY, { ...manifest, [sessionId]: paths })
}

// `true` — путь явно внутри <CFG>\projects; `false` — явно снаружи;
// 'unknown' — разместить не удалось (fail-closed: гвардия откажет).
async function insideProjects(
  $: EngineSubset,
  path: string,
): Promise<boolean | 'unknown'> {
  const root = projectsDir(await configRoot($))
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const name = cut < 0 ? path : path.slice(cut + 1)
  const placeable = name !== '' && name !== '.' && name !== '..'
  if (!placeable) {
    return 'unknown'
  }

  const own = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  if (own !== undefined && own.realPath !== undefined) {
    return isUnder(own.realPath, root)
  }

  // Write может называть ещё не созданный файл — резолвим по папке
  // (каноничный приём из d.ts движка).
  const folder = cut < 0 ? '.' : path.slice(0, cut + 1)
  const dir = await $.fs.stat(folder, { resolve: true }).catch(() => undefined)
  if (dir?.realPath === undefined) {
    return 'unknown'
  }
  const stitched = `${dir.realPath.replace(/[\\/]$/, '')}\\${name}`
  return isUnder(stitched, root)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command
      .register({
        name: 'anon',
        description: 'claude anon — анонимный режим (сессия не сохраняется, память не пишется)',
        argumentHint: '[on|off]',
      })
      .catch(() => undefined) // повторный session.start (resume, тесты) не валит хук

    await sweepOrphans($)

    const isLauncher = (await $.env.get('CLAUDE_ANON')) === '1'
    await update($, launcherMode, () => isLauncher)

    if (isLauncher) {
      await update($, anonOn, () => true)

      // Лаунчер ставит заголовок до старта; переписываем, если CC успел перебить.
      if (e.surface === 'terminal') {
        try {
          await $.process.run(setTitleArgv(ANON_TITLE))
        } catch {
          /* заголовок — не критично */
        }
      }
    }

    return next(e)
  })

  on('command.run', { command: 'anon' }, async ($, e) => {
    const current = await read($, anonOn)
    const launcher = await read($, launcherMode)
    const decision = decideAnon(e.args, current, launcher)

    if (decision.refuse) {
      $.ui.toast(decision.refuseText)
      return { text: 'claude anon остаётся включённым — профиль запущен лаунчером anon.' }
    }

    // Sticky: запись ставится один раз при первом включении и не снимается
    // при off (снятую с транскрипта запись не «раз-инкогнитить»).
    if (decision.want && !current && !launcher) {
      await recordOwnSession($)
    }

    await update($, anonOn, () => decision.want)

    if (decision.want) {
      if (!launcher) {
        await saveTitleIfUnsaved($)
        try {
          await $.process.run(setTitleArgv(ANON_TITLE))
        } catch {
          /* заголовок — не критично */
        }
      }
      $.ui.toast('claude anon on — сессия не сохранится')
      return { text: 'claude anon on — сессия не сохранится, память не пишется.' }
    }

    if (!launcher) {
      await restoreTitleNow($)
    }
    $.ui.toast('claude anon off — эта беседа всё равно не сохранится')
    return {
      text: 'claude anon off. Полосу, лейбл и блокировки на будущее снял; ' +
        'запись этой беседы в манифест осталась — при выходе она удалится.',
    }
  })

  // Band вплотную над полем ввода: фиолетовая полоса с маскотом. Уступает
  // опросу (hasSurvey) — опрос рисуется той же зоной. Выключен — ничего.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await read($, anonOn)) || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const note = bandNote(await read($, launcherMode))

    return (
      <Box backgroundColor={ANON_BG} width={e.props.bodyColumns} paddingX={1}>
        <Text color={ANON_MASKOT}>{MASKOT} </Text>
        <Text color={ANON_FG}>
          claude anon · {note} · {BAND_SUFFIX}
        </Text>
      </Box>
    )
  })

  // Лейбл рядом с нативным рядом режимов: своя ветка композиции с next(e)
  // даёт палитру; переписывание props.modes разрисовать бы не смогло.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const rest = await next(e)

    return (
      <Box>
        {rest}
        <Text color={ANON_ACCENT}>· claude anon</Text>
      </Box>
    )
  })

  // Гвардия Write/Edit: в анонимном режиме никаких записей под каталогом
  // проектных сессий движка (там же память). Не-resolvable — deny.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }
    const inside = await insideProjects($, String(e.file_path ?? ''))
    if (inside !== false) {
      // false = снаружи и можно; true и 'unknown' (не резолвится) — deny.
      return { deny: ANON_DENY_MESSAGE }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${ANON_DENY_MESSAGE} (guard упал)` },
  )

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }
    const inside = await insideProjects($, String(e.file_path ?? ''))
    if (inside !== false) {
      return { deny: ANON_DENY_MESSAGE }
    }
    return next(e)
  }).catch(($, e, next) =>
    next.called ? next(e) : { deny: `${ANON_DENY_MESSAGE} (guard упал)` },
  )

  // Политика режима в системный промпт — одной секцией в конец, идемпотентно.
  on('prompt.compose', async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }

    const composed = await next(e)
    if (composed === undefined) {
      return next(e)
    }

    const sections = appendPolicy(composed.sections, ANON_POLICY_TEXT)
    return { ...composed, sections }
  })

  // Выход из сессии: удалить всё, что подлежало удалению. Бюджет хука 1.5с —
  // только быстрые cmd-операции. /clear — процесс живёт дальше: переносим
  // анонимность на новый id, заголовок не трогаем.
  on('session.end', async ($, e, next) => {
    const stillAnon = await read($, anonOn)

    if (e.reason === 'clear' && stillAnon) {
      // /clear: беседа убита — её файл больше не нужен и должен быть удалён;
      // процесс продолжается анонимно под новым id (session.start не придёт).
      const newId = await $.session.id()
      if (newId !== '' && newId !== e.sessionId && !(await read($, launcherMode))) {
        await recordOwnSession($)
      }
      await dropManifestEntry($, e.sessionId)

      return next(e)
    }

    await dropManifestEntry($, e.sessionId)
    await restoreTitleNow($)

    return next(e)
  })
}