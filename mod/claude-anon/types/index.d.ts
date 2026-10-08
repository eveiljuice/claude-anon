declare module 'claude-code' {
  interface PluginState {
    'anon-mode': {
      anonOn: boolean
      launcherMode: boolean
      restoredTitle: string | null
    }
  }
}