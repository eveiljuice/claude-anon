import { describe, test, expect } from 'claude-code/testing'
import {
  armEngineOps,
  armLifecycle,
  armPromptAttachment,
  armPromptCompose,
  armPromptContext,
  type Armed,
} from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

const CLAUDE_BLOCKS = [
  { name: 'claudeMd', text: 'Codebase and user instructions are shown below.' },
  { name: 'userEmail', text: 'me@example.com' },
  { name: 'attachedProject', text: 'Project Foo' },
  { name: 'gitStatus', text: 'branch: main' },
  { name: 'currentDate', text: "Today's date is 2026-10-08." },
] as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 24,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 24 },
  view: {},
} as const

// Движок требует: каждая shared-секция впереди session-секций.
const BAND_SECTIONS = [
  { id: 'intro', text: 'You are Claude Code', scope: 'shared' },
  { id: 'tone', text: 'Tone and style', scope: 'shared' },
  { id: 'memory', text: '# Memory', scope: 'session' },
  { id: 'pronouns', text: 'pronouns guidance', scope: 'session' },
] as const

// Банд рисуется из натива-мока: armNativeRender здесь не нужен — band
// на AbovePrompt тестируется в render.test.tsx; здесь только текст-заглушка
// через findAll не доступен. Проверяем честность bandNote через состояние
// (contextUnloaded) — рендер её читает (render.test.tsx покрывает отрисовку).
async function bandState(armed: Armed): Promise<boolean> {
  return armed.state.get('anon-mode/contextUnloaded') === true
}

// Полный вход оп-композиции (см. guard.test.ts): model, promptModel,
// surfaces, tools, outputStyle (null — дефолтный стиль), traits.
const COMPOSE = {
  model: 'test-model',
  promptModel: 'test-model',
  surfaces: ['terminal'] as const,
  tools: [],
  outputStyle: null,
  traits: [],
} as const

describe('prompt.context — первый ход', () => {
  test('при анон вырезает claudeMd/userEmail/attachedProject/gitStatus, файлы пусты', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptContext(on)
    await $.command.run(RUN('on'))

    const res = await $.prompt.context({
      blocks: [...CLAUDE_BLOCKS],
      instructionFiles: [{ kind: 'user', path: 'C:\\Users\\ok\\.claude\\CLAUDE.md', content: 'rules' }],
    })

    expect(res.blocks).toEqual([
      { name: 'currentDate', text: "Today's date is 2026-10-08." },
    ])
    // Движок при вырезанном claudeMd нормализует отсутствующие файлы в
    // undefined; семантика одинакова: файлов за claudeMd в беседе нет.
    expect(res.instructionFiles ?? []).toEqual([])
  })

  test('без анона блоки уходят как есть', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    armLifecycle(on)
    armPromptContext(on)

    const res = await $.prompt.context({
      blocks: [...CLAUDE_BLOCKS],
      instructionFiles: [],
    })

    expect(res.blocks).toEqual([...CLAUDE_BLOCKS])
    expect(await bandState(armed)).toBe(false) // state не тронут
  })

  test('состояние contextUnloaded ставится после вырезки (band честен)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    armLifecycle(on)
    armPromptContext(on)
    expect(await bandState(armed)).toBe(false)

    await $.command.run(RUN('on'))
    await $.prompt.context({ blocks: [...CLAUDE_BLOCKS] })

    expect(await bandState(armed)).toBe(true)
  })

  test('включение после хода с контекстом: вырезки не было, state остаётся ложным', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    armLifecycle(on)
    armPromptContext(on)

    // Контекст собран до включения (blocки уехали в предыдущем ходе)...
    await $.prompt.context({ blocks: [...CLAUDE_BLOCKS] })
    // ...и только потом /anon
    await $.command.run(RUN('on'))

    expect(await bandState(armed)).toBe(false) // band покажет «context loaded before going anon»
  })

  test('off снимает выгрузку: та же беседа уже несёт контекст, честность важнее', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    armLifecycle(on)
    armPromptContext(on)

    await $.command.run(RUN('on'))
    await $.prompt.context({ blocks: [...CLAUDE_BLOCKS] }) // вырезка → true
    await $.command.run(RUN('off'))

    expect(await bandState(armed)).toBe(false) // после off в беседе есть контекст
  })
})

describe('prompt.attachment — вложения per-turn', () => {
  test('при анон памятные вложения не уходят (text: null)', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptAttachment(on)
    await $.command.run(RUN('on'))

    for (const type of ['relevant_memories', 'nested_memory', 'current_session_memory', 'team_context']) {
      const res = await $.prompt.attachment({ type } as never)
      expect(res.text).toBeNull()
    }
  })

  test('при анон прочие вложения проходят', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptAttachment(on)
    await $.command.run(RUN('on'))

    const res = await $.prompt.attachment({ type: 'todo_reminder' } as never)
    expect(res.text).toBe('native attachment')
  })

  test('без анона вложения не глушатся', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptAttachment(on)

    const res = await $.prompt.attachment({ type: 'relevant_memories' } as never)
    expect(res.text).toBe('native attachment')
  })
})

describe('prompt.compose — секции памяти системного промпта', () => {
  test('при анон memory/pronouns вырезаны, политика добавлена в конец', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptCompose(on, [...BAND_SECTIONS])
    await $.command.run(RUN('on'))

    const res = await $.prompt.compose(COMPOSE)
    const ids = res.sections.map(s => s.id)
    expect(ids).not.toContain('memory')
    expect(ids).not.toContain('pronouns')
    expect(ids).toContain('intro')
    expect(ids).toContain('tone')
    expect(ids[ids.length - 1]).toBe('anon-mode:policy')
  })

  test('без анона секции не тронуты', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptCompose(on, [...BAND_SECTIONS])

    const res = await $.prompt.compose(COMPOSE)
    expect(res.sections).toEqual([...BAND_SECTIONS])
  })

  test('выключение снимает и вырезку, и политику на следующих рендерах', { timeoutMs: 15000 }, async ($, on) => {
    armEngineOps(on)
    armLifecycle(on)
    armPromptCompose(on, [...BAND_SECTIONS])
    await $.command.run(RUN('on'))
    await $.command.run(RUN('off'))

    const res = await $.prompt.compose(COMPOSE)
    expect(res.sections).toEqual([...BAND_SECTIONS])
  })
})