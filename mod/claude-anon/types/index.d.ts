declare module 'claude-code' {
  interface PluginState {
    'anon-mode': {
      anonOn: boolean
      launcherMode: boolean
      restoredTitle: string | null
      notice: string | null
      /** Контекст первого хода вырезан после включения → band «memory unloaded». */
      contextUnloaded: boolean | null
      /** Контекст беседы композован без фильтра (личное в истории) → /anon on предложит /clear. */
      contextTainted: boolean
    }
  }
}