// claude anon — инкогнито-режим: чистый контекст, сессия не сохраняется,
// память не пишется, телеметрию глушит лаунчер; клиент красится в фиолетовый.
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  BAND_SUFFIX,
  MEMORY_ATTACHMENT_TYPES,
  acceptedAnswer,
  appendPolicy,
  bandNote,
  confirmOptions,
  confirmQuestion,
  decideAnon,
  dropContextBlocks,
  stripMemorySections,
} from './logic'
import {
  configDir,
  fileHistoryDir,
  historyPath,
  isUnder,
  projectsDir,
  sessionFilePaths,
  todosDir,
} from './paths'
import { ANON_TITLE, readTitleArgv, restoreTitleArgv, setTitleArgv } from './title'

const MANIFEST_KEY = 'anon-manifest'

/** Флаг «процесс продолжается анонимно после /clear»: ставится clear-ветвью
 * session.end, снимается следующим session.end (тогда транскрипт
 * пост-клировской беседы записывается и удаляется) или /anon off. */
const FLAG_KEY = 'anon-continue'

/** Флаг «диалог согласия уже показан и пройден»: в $.store, между сессиями —
 * повторные включения в новом профиле не спрашивают снова. */
const CONFIRM_FLAG = 'anon-confirm-seen'

const ANON_POLICY_TEXT =
  'claude anon mode is on: do not write to memory (MEMORY.md and auto-memory files), ' +
  "do not reference the user's memory, CLAUDE.md or prompt history — " +
  'they were not loaded in this session — and do not personalize answers.'

const ANON_DENY_MESSAGE =
  "claude anon: writes under the engine's projects directory are blocked"

export type ManifestRecord = { transcriptPath: string; sessionDir: string }
export type AnonManifest = Record<string, ManifestRecord>

const anonOn = atom({ plugin: 'anon-mode', key: 'anonOn' } as const, false)
const launcherMode = atom({ plugin: 'anon-mode', key: 'launcherMode' } as const, false)
/** Контекст первого хода вырезан после включения — band обещает «memory unloaded». */
const contextUnloaded = atom(
  { plugin: 'anon-mode', key: 'contextUnloaded' } as const,
  null as boolean | null,
)

// --- палитра (спека §3.2) ---
const ANON_BG = '#4b2e83'
const ANON_FG = '#f2ecff'
const ANON_ACCENT = '#b98cff'
const ANON_MASKOT = '#9b6bff'
const MASKOT = '◉‿◉'

const restoredTitle = atom({ plugin: 'anon-mode', key: 'restoredTitle' } as const, null)
const notice = atom({ plugin: 'anon-mode', key: 'notice' } as const, null)

const NOTICE_MS = 4000

/** Заметка о переключении: рисуется под полем ввода (PromptHint.tail),
 * не тостом в правом верхнем углу. Гаснет через NOTICE_MS. Сет ОБЯЗАН
 * await-нуться внутри хендлера (host-правило: state.set вне диспетча
 * отказано); гашение — колбеком таймера, живущим в среде плагина.
 * В тест-движке часов нет — catch осталяет заметку до следующего события. */
async function showNotice($: EngineSubset, text: string): Promise<void> {
  await update($, notice, () => text)

  try {
    const wait: Promise<void> = $.clock.after(NOTICE_MS, () => update($, notice, () => null))
    wait.catch(() => undefined)
  } catch {
    /* часов нет (тест-движок): заметка остаётся до следующего события */
  }
}

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
    read: (path: string) => Promise<string>
    write: (path: string, text: string) => Promise<void>
    list: (path?: string) => Promise<{ name: string; kind: string }[]>
  }
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    delete: (key: string) => Promise<void>
  }
  process: {
    run: (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  }
  clock: {
    after: (ms: number, fn: () => unknown) => Promise<void>
  }
  ui: {
    ask: (question: string, options?: readonly string[]) => Promise<string>
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

/** Удаляет файлы записи; отсутствующее на диске проходит тихо. Возвращает,
 * удалилось (или ничего удалять не было): при неудаче запись остаётся на ретрай. */
async function deleteQuietly($: EngineSubset, rec: ManifestRecord): Promise<boolean> {
  const root = projectsDir(await configRoot($))
  // Контейнмент (I2): чистим только под каталогом проектов движка —
  // испорченная/чужая запись из $.store не имеет права указать за его пределы.
  if (!isUnder(rec.transcriptPath, root) || !isUnder(rec.sessionDir, root)) {
    return false
  }

  let ok = true
  if (await $.fs.exists(rec.transcriptPath)) {
    const { exitCode } = await $.process.run(['cmd', '/c', 'del', '/q', '/f', rec.transcriptPath])
    if (exitCode !== 0 || (await $.fs.exists(rec.transcriptPath))) {
      ok = false
    }
  }
  if (await $.fs.exists(rec.sessionDir)) {
    const { exitCode } = await $.process.run(['cmd', '/c', 'rd', '/s', '/q', rec.sessionDir])
    if (exitCode !== 0 || (await $.fs.exists(rec.sessionDir))) {
      ok = false
    }
  }
  return ok
}

/** Удаляет файлы записи и снимает её; на неудачу удаления запись остаётся
 * (ретрай на следующем session.start — sweep). В тот же ретрай-класс идут и
 * побочные файлы профиля, помеченные id сессии: чистка идёт при снимке записи. */
async function dropManifestEntry($: EngineSubset, sessionId: string): Promise<void> {
  const manifest = await readManifest($)
  const rec = manifest[sessionId]
  if (rec === undefined) {
    return
  }
  let ok = await deleteQuietly($, rec)
  if (ok) {
    ok = await scrubSideFiles($, sessionId)
  }
  if (!ok) {
    return // ретрай на следующем session.start (sweep)
  }
  const next: AnonManifest = { ...manifest }
  delete next[sessionId]
  await $.store.set(MANIFEST_KEY, next)
}

// --- побочные файлы профиля: history.jsonl, todos, file-history ---
// Всё отсутствующее проходит тихо; неудача — «не убрано» (запись остаётся).

async function scrubSideFiles($: EngineSubset, sessionId: string): Promise<boolean> {
  const config = await configRoot($)

  // history.jsonl: снять строки этой сессии; без своих строк файл не
  // переписывается зря.
  const hist = historyPath(config)
  let held: string | undefined
  try {
    held = await $.fs.read(hist)
  } catch {
    /* файла нет — убирать нечего */
  }
  if (held !== undefined) {
    const own = (line: string) => line.includes(`"sessionId":"${sessionId}"`)
    const lines = held.split('\n')
    if (lines.some(own)) {
      try {
        await $.fs.write(hist, lines.filter(line => !own(line)).join('\n'))
      } catch {
        return false
      }
    }
  }

  // todos/: файлы тулзы-списка этой сессии — `<id>.json` и `<id>-agent-*.json`.
  // Имена берутся только из fs.list (не из id) — испорченный ключ манифеста
  // пути не указывает.
  const todosRoot = todosDir(config)
  let todoEntries: { name: string; kind: string }[]
  try {
    todoEntries = await $.fs.list(todosRoot)
  } catch {
    todoEntries = [] // каталога нет
  }
  for (const entry of todoEntries) {
    if (entry.kind !== 'file') {
      continue
    }
    if (entry.name === `${sessionId}.json` || entry.name.startsWith(`${sessionId}-`)) {
      const todo = `${todosRoot}\\${entry.name}`
      try {
        const { exitCode } = await $.process.run(['cmd', '/c', 'del', '/q', '/f', todo])
        if (exitCode !== 0 || (await $.fs.exists(todo))) {
          return false
        }
      } catch {
        return false
      }
    }
  }

  // file-history/: каталог снапшотов этой сессии. Испорченный id из $.store
  // ограничен containment — каталог file-history в профиль не пускает наружу.
  const historyRoot = fileHistoryDir(config)
  const snapshotDir = `${historyRoot}\\${sessionId}`
  if (!isUnder(snapshotDir, historyRoot)) {
    return false
  }
  if (await $.fs.exists(snapshotDir)) {
    try {
      const { exitCode } = await $.process.run(['cmd', '/c', 'rd', '/s', '/q', snapshotDir])
      if (exitCode !== 0 || (await $.fs.exists(snapshotDir))) {
        return false
      }
    } catch {
      return false
    }
  }

  return true
}

/** Дочистка сирот после хард-килла: чужие записи удаляем (неудачные — оставляем
 * на следующий ретрай), свою оставляем. */
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
    const ok = await deleteQuietly($, manifest[id])
    if (ok) {
      changed = true
    } else {
      keep[id] = manifest[id]
    }
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

/** Первое включение — через диалог согласия (аналог WARNING
 * dangerously-skip-permissions). Согласие запоминается в $.store: в следующих
 * сессиях диалог не повторяется. Отказ, dismiss или невозможность спросить —
 * режим не включается (fail-closed). Лаунчер спроса не ведёт: согласие
 * выражено самим запуском через anon.ps1. */
async function confirmEnable($: EngineSubset): Promise<boolean> {
  if ((await $.store.get(CONFIRM_FLAG)) === true) {
    return true
  }
  let label: string
  try {
    // $.ui.ask — прямой вызов; читать член $ как значение компилятор движка
    // запрещает. Тест-движок ask не даёт вовсе (TypeError) — тот же catch.
    label = await $.ui.ask(confirmQuestion(), confirmOptions())
  } catch {
    return false // dismissed (Esc) или диалог не состоялся — согласия нет
  }
  if (!acceptedAnswer(label)) {
    return false
  }
  await $.store.set(CONFIRM_FLAG, true)
  return true
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
        description: 'claude anon — incognito mode (session is not saved, memory is not written)',
        argumentHint: '[on|off]',
      })
      .catch(() => undefined) // повторный session.start (resume, тесты) не валит хук

    await sweepOrphans($)

    const isLauncher = (await $.env.get('CLAUDE_ANON')) === '1'
    await update($, launcherMode, () => isLauncher)

    // Перевооружение (M3): у записанной в манифест сессии band/гвардия
    // включаются снова — так ведёт себя resume пережившей хард-килл сессии.
    const manifest = await readManifest($)
    if (manifest[(await $.session.id())] !== undefined) {
      await update($, anonOn, () => true)
    }

    // Флаг продолжения из СВОЕГО процесса снимает сам его session.end;
    // доживший до нового процесса флаг (крэш после /clear) — только глотаем:
    // той беседы вместе с state уже нет, перевооружать нечего.
    if ((await $.store.get(FLAG_KEY)) === true) {
      await $.store.delete(FLAG_KEY)
    }

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
      await showNotice($, decision.refuseText)
      return { text: decision.refuseText }
    }

    // Sticky: запись ставится один раз при первом включении и не снимается
    // при off (снятую с транскрипта запись не «раз-инкогнитить»).
    if (decision.want && !current && !launcher) {
      // Лаунчер-режим согласия не спрашивает (см. confirmEnable), mid-session —
      // спросит ровно раз за жизнь установки.
      const accepted = await confirmEnable($)
      if (!accepted) {
        await showNotice($, 'claude anon: not enabled')
        return { text: 'claude anon: left off — nothing changed.' }
      }
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
      await showNotice($, 'claude anon on — session will not be saved')
      return { text: 'claude anon on — the session will not be saved, memory writes are blocked.' }
    }

    if (!launcher) {
      await restoreTitleNow($)
      // Явный off в пост-клировской беседе отменяет её отложенное удаление:
      // эта беседа — новая сессия, /anon в ней не включали.
      await $.store.delete(FLAG_KEY)
    }
    // Та же беседа после off уже несёт контекст; повторное включение обязано
    // показать «context loaded before going anon», а не «memory unloaded».
    await update($, contextUnloaded, () => false)
    await showNotice($, 'claude anon off — this conversation stays unsaved')
    return {
      text: 'claude anon off. Removed the band, the footer label and the blocks ' +
        'for future turns; this conversation stays unsaved — its transcript ' +
        'is deleted at exit.',
    }
  })

  // Band вплотную над полем ввода: фиолетовая полоса с маскотом. Уступает
  // опросу (hasSurvey) — опрос рисуется той же зоной. Выключен — ничего.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await read($, anonOn)) || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const note = bandNote(await read($, launcherMode), await read($, contextUnloaded))

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

  // Заметка о переключении — в конец нативной строки-хинта ПОД полем ввода
  // (tail рисуется движком после нативной строки, пилюли остаются живыми).
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const text = await read($, notice)
    if (text === null) {
      return next(e)
    }
    return next({ ...e, props: { ...e.props, tail: `· ${text}` } })
  })

  // Политика режима в системный промпт — одной секцией в конец, идемпотентно.
  // Секции памяти (memory, pronouns) при анон не уходят: срезаются до
  // добавления политики.
  on('prompt.compose', async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }

    const composed = await next(e)
    if (composed === undefined) {
      return next(e)
    }

    const sections = appendPolicy(stripMemorySections(composed.sections), ANON_POLICY_TEXT)
    return { ...composed, sections }
  })

  // Контекст первого хода: claudeMd/userEmail/attachedProject/gitStatus не
  // уходят, файлы за claudeMd сняты. Полоса честна: вырезка состоялась —
  // state ставится моментом вырезки (ход до включения не ставит).
  on('prompt.context', async ($, e, next) => {
    if (!(await read($, anonOn))) {
      return next(e)
    }

    const composed = await next(e)
    if (composed === undefined) {
      return next(e)
    }

    await update($, contextUnloaded, () => true)
    return { blocks: dropContextBlocks(composed.blocks), instructionFiles: [] }
  })

  // Памятные вложения per-turn: реколл памяти, ре-инъекция CLAUDE.md/MEMORY.md,
  // память сессии, team-контекст — при анон каждое уходит с text: null.
  for (const type of MEMORY_ATTACHMENT_TYPES) {
    on('prompt.attachment', { type } as { type: typeof type }, async ($, e, next) => {
      if (!(await read($, anonOn))) {
        return next(e)
      }
      void e
      return { text: null }
    })
  }

  // Выход из сессии: удалить всё, что подлежало удалению. Бюджет хука 1.5с —
  // только быстрые cmd-операции. /clear — процесс живёт дальше: переносим
  // анонимность на новый id, заголовок не трогаем.
  on('session.end', async ($, e, next) => {
    const stillAnon = await read($, anonOn)

    if (e.reason === 'clear' && stillAnon) {
      // /clear: старая беседа убита — файлы удаляются сейчас. Не полагаемся на
      // тайминг id (на этапе end $.session.id() ещё может отвечать старым):
      // вместо немедленной записи ставим флаг — пост-клировскую беседу запишет
      // и удалит СВОЙ session.end. session.start на /clear не приходит.
      if (!(await read($, launcherMode))) {
        await $.store.set(FLAG_KEY, true)
        // Belt (M3): state мог пережить /clear — band/гвардия обязаны остаться.
        await update($, anonOn, () => true)
      }
      await dropManifestEntry($, e.sessionId)

      return next(e)
    }

    if ((await $.store.get(FLAG_KEY)) === true) {
      // Завершается пост-клировская беседа: id уже актуален — записываем и
      // удаляем её транскрипт наравне с исходной.
      await recordOwnSession($)
      await $.store.delete(FLAG_KEY)
    }
    await dropManifestEntry($, e.sessionId)
    await restoreTitleNow($)

    return next(e)
  })
}