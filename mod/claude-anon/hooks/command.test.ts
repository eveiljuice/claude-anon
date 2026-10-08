import { describe, test, expect } from 'claude-code/testing'
import type { AnonManifest } from './register'
import { armEngineOps } from './test-support'

const RUN = (args: string) => ({
  command: 'anon',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 80 } as const,
})

describe('/anon toggle', () => {
  test('голая /anon включает и пишет манифест', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    const answer = await $.command.run(RUN(''))

    expect(answer.text).toContain('on')
    expect(armed.toasts.join(' ')).toContain('on')

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    const ids = Object.keys(manifest)
    expect(ids.length).toBe(1)

    const rec = manifest[ids[0]]
    expect(rec.transcriptPath).toContain('\\projects\\')
    expect(rec.transcriptPath.endsWith('.jsonl')).toBe(true)
    expect(rec.sessionDir.endsWith('\\' + ids[0])).toBe(true)
    expect(ids[0]).toBe('test-session-anon')
  })

  test('sticky off: off не снимает запись манифеста (Review Focus 4)', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    await $.command.run(RUN('on'))
    await $.command.run(RUN('off'))

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    expect(Object.keys(manifest).length).toBe(1)
  })

  test('повторный on не плодит записи манифеста', { timeoutMs: 15000 }, async ($, on) => {
    const armed = armEngineOps(on)
    await $.command.run(RUN('on'))
    await $.command.run(RUN('on'))

    const manifest = armed.store.get('anon-manifest') as AnonManifest
    expect(Object.keys(manifest).length).toBe(1)
  })
})