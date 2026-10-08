// Тестовый арм для op-событий движка: в тест-движке хост не отвечает ни на
// одну $-op — тест поднимает их под плагином сам (контракт ответа — `{ value }`,
// OpEventOf движка). Всё hermetic: store/state/fs в памяти, process.run
// записывает argv и ничего не делает. Импортировать только из *.test.ts(x).
// Файл .tsx: armNativeRender содержит JSX.
import type { On } from 'claude-code/testing'

export type Armed = {
  store: Map<string, unknown>
  state: Map<string, unknown>
  stateVersions: Map<string, number>
  fsFiles: Map<string, string>
  fsDirs: Set<string>
  argvs: string[][]
  toasts: string[]
}

export type ArmOptions = {
  env?: Record<string, string | undefined>
  sessionId?: string
  cwd?: string
  /** Все process.run в этом тесте отвечают этим exitCode (для тестов ретрая). */
  processExitCode?: number
}

/** Дефолтный armированный session.id: в теле теста op недоступны, id берут отсюда. */
export const TEST_SESSION_ID = 'test-session-anon'

export function armEngineOps(on: On, options: ArmOptions = {}): Armed {
  const env = options.env ?? {
    USERPROFILE: 'C:\\Users\\ok',
    TEMP: 'C:\\Users\\ok\\AppData\\Local\\Temp',
  }
  const sessionId = options.sessionId ?? 'test-session-anon'
  const cwd = options.cwd ?? 'C:\\Users\\ok\\tmp-anon-mode-test'
  const tempRoot = env.TEMP ?? 'C:\\Users\\ok\\AppData\\Local\\Temp'

  const armed: Armed = {
    store: new Map(),
    state: new Map(),
    stateVersions: new Map(),
    fsFiles: new Map(),
    fsDirs: new Set([cwd, tempRoot]),
    argvs: [],
    toasts: [],
  }

  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: cwd }))

  on('store.get', ($, e) => ({ value: armed.store.get(e.key) }))
  on('store.set', ($, e) => {
    armed.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    armed.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...armed.store.keys()] }))

  on('state.get', ($, e) => {
    const ref = `${e.plugin}/${e.key}`
    const held = armed.state.get(ref)
    return { value: { value: held, version: armed.stateVersions.get(ref) ?? 0 } }
  })
  on('state.set', ($, e) => {
    const ref = `${e.plugin}/${e.key}`
    armed.state.set(ref, e.value)
    const version = (armed.stateVersions.get(ref) ?? 0) + 1
    armed.stateVersions.set(ref, version)
    return { value: { isSet: true, version } }
  })

  on('ui.toast', ($, e) => {
    armed.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))

  on('command.register', ($, e) => ({ value: { command: e.name } }))

  // --- in-memory fs ---
  on('fs.write', ($, e) => {
    armed.fsFiles.set(e.path, e.text)
    const cut = Math.max(e.path.lastIndexOf('/'), e.path.lastIndexOf('\\'))
    if (cut > 0) armed.fsDirs.add(e.path.slice(0, cut))
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: armed.fsFiles.has(e.path) || armed.fsDirs.has(e.path) }))
  on('fs.stat', ($, e) => {
    const path = e.path
    const isKnown = armed.fsFiles.has(path) || armed.fsDirs.has(path)
    const kind = armed.fsFiles.has(path) ? 'file' : 'dir'
    if (!isKnown) {
      // folder-фолбэк, как у настоящей fs.stat: файл ещё не создан, но папка есть
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      const folder = cut < 0 ? '' : path.slice(0, cut)
      if (folder === '' || !armed.fsDirs.has(folder)) {
        return { deny: 'ENOENT (test fs)' }
      }
      const name = path.slice(cut + 1)
      return {
        value: {
          kind: 'file',
          size: 0,
          mtimeMs: 0,
          isLink: false,
          ...(e.resolve ? { realPath: `${folder.replace(/[\\/]$/, '')}\\${name}` } : {}),
        },
      }
    }
    return {
      value: {
        kind,
        size: kind === 'file' ? (armed.fsFiles.get(path) ?? '').length : 0,
        mtimeMs: 0,
        isLink: false,
        ...(e.resolve ? { realPath: path } : {}),
      },
    }
  })
  on('fs.list', ($, e) => {
    const dir = (e.path ?? '.').replace(/[\\/]$/, '')
    const entries = [
      ...[...armed.fsDirs].filter(one => {
        const cut = Math.max(one.lastIndexOf('/'), one.lastIndexOf('\\'))
        return cut >= 0 && one.slice(0, cut) === dir
      }).map(name => ({ name: name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1), kind: 'dir', size: 0, mtimeMs: 0, isLink: false })),
      ...[...armed.fsFiles.keys()].filter(one => {
        const cut = Math.max(one.lastIndexOf('/'), one.lastIndexOf('\\'))
        return cut >= 0 && one.slice(0, cut) === dir
      }).map(name => ({ name: name.slice(name.lastIndexOf('\\') + 1), kind: 'file', size: 0, mtimeMs: 0, isLink: false })),
    ]
    return { value: entries }
  })

  // process.run: записывает argv и имитирует эффект cmd del/rd над фейковым fs
  // (нужен механике ретрая: проверка exists-after у deleteQuietly),
  // реального запуска в тестах нет.
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    armed.argvs.push(argv)
    if (argv[0] === 'cmd' && argv[1] === '/c' && argv[2] === 'del') {
      armed.fsFiles.delete(argv[argv.length - 1])
    }
    if (argv[0] === 'cmd' && argv[1] === '/c' && argv[2] === 'rd') {
      const dir = argv[argv.length - 1]
      armed.fsDirs.delete(dir)
      for (const key of [...armed.fsFiles.keys(), ...armed.fsDirs]) {
        if (key.startsWith(dir + '\\')) {
          armed.fsFiles.delete(key)
          armed.fsDirs.delete(key)
        }
      }
    }
    return { value: { exitCode: options.processExitCode ?? 0, stdout: '', stderr: '' } }
  })

  return armed
}

/** Нижний фейк-промпт-композиция: в тест-движке у host нет собственной
 * композиции — тест отвечает пустыми секциями. prompt.compose — engine-событие:
 * ответ напрямую `{ sections }`, не через `{ value }` (это форма op). */
export function armPromptCompose(on: On): void {
  on('prompt.compose', () => ({ sections: [] }))
}

/** Нижний фейк-раннер тула: в тест-движке core не исполняет инструменты,
 * тест отвечает структурой результата Write/Edit; tool.call — engine-событие,
 * ответ напрямую `{ result }`, не через `{ value }`. */
export function armBottomTools(on: On): void {
  on(
    'tool.call',
    async ($, e, next) => {
      const input = e as { tool: string; file_path?: string }
      if (input.tool === 'Write' || input.tool === 'Edit') {
        return {
          result: {
            type: input.tool === 'Write' ? 'create' : 'update',
            filePath: String(input.file_path ?? ''),
            content: '<fake>',
            structuredPatch: [],
            originalFile: null,
          },
        }
      }
      return next(e)
    },
  )
}

/** Нижние фейк-ответы жизненного цикла: у test-движка нет ядра для
 * session.start/session.end — тест отвечает их результатными формами
 * (SessionStartResult { cwd }, SessionEndResult { sessionId }). */
export function armLifecycle(on: On, sessionId = TEST_SESSION_ID): void {
  on('session.start', ($, e, next) => ({ cwd: e.cwd }))
  on('session.end', ($, e, next) => {
    void next
    return { sessionId }
  })
}

/** Нижний фейк-«нативный» рендер: в тест-движке у mount нет своего отрисовщика,
 * поэтому для компонент, где плагин пасует (next(e)), тест отвечает сам —
 * иначе mount бросает «no implementation for ui.render». */
export function armNativeRender(
  on: On,
  components: readonly string[] = ['AbovePrompt', 'SessionMode'],
): void {
  for (const component of components) {
    on('ui.render', { component } as { component: typeof component }, ($, e, next) => {
      const { Text } = $.ui.resolve(e)
      const props = e.props as { modes?: readonly string[] }
      const shown =
        e.component === 'SessionMode' && props.modes !== undefined
          ? props.modes.join(' & ') // движок рисует режимы «joined by & »
          : `native/${component}`
      return <Text>{shown}</Text>
    })
  }
}