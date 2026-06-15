describe('settingsStore persistence', () => {
  const storageKey = 'aitube-kit-settings'
  const originalSelectedVrmPath = process.env.NEXT_PUBLIC_SELECTED_VRM_PATH
  const originalAlwaysOverride =
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES
  const originalSystemCellAIService =
    process.env.NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE
  const originalSelectAIService = process.env.NEXT_PUBLIC_SELECT_AI_SERVICE
  const originalProjectionVisualAIService =
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE
  const originalThoughtCoreBaseUrl =
    process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL

  const loadStore = () => {
    jest.resetModules()
    return require('@/features/stores/settings').default
  }

  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name]
      return
    }
    process.env[name] = value
  }

  afterEach(() => {
    localStorage.clear()
    restoreEnv('NEXT_PUBLIC_SELECTED_VRM_PATH', originalSelectedVrmPath)
    restoreEnv(
      'NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES',
      originalAlwaysOverride
    )
    restoreEnv(
      'NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE',
      originalSystemCellAIService
    )
    restoreEnv('NEXT_PUBLIC_SELECT_AI_SERVICE', originalSelectAIService)
    restoreEnv(
      'NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE',
      originalProjectionVisualAIService
    )
    restoreEnv('NEXT_PUBLIC_THOUGHT_CORE_BASE_URL', originalThoughtCoreBaseUrl)
  })

  it('prefers environment values before components read the store when override is enabled', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/nikechan_v2.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'true'

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectedVrmPath: '/vrm/nikechan_v1.vrm',
        },
        version: 0,
      })
    )

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectedVrmPath).toBe(
      '/vrm/nikechan_v2.vrm'
    )
  })

  it('keeps persisted values when override is disabled', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/nikechan_v2.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectedVrmPath: '/vrm/nikechan_v1.vrm',
        },
        version: 0,
      })
    )

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectedVrmPath).toBe(
      '/vrm/nikechan_v1.vrm'
    )
  })

  it('uses the configured System Cell AI service over persisted provider state', () => {
    process.env.NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE = 'thought-core'
    process.env.NEXT_PUBLIC_SELECT_AI_SERVICE = ''
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE = ''
    process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL = 'http://127.0.0.1:18888'

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectAIService: 'openai',
          thoughtCoreUrl: 'http://127.0.0.1:18787',
        },
        version: 0,
      })
    )

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectAIService).toBe('thought-core')
    expect(settingsStore.getState().thoughtCoreUrl).toBe(
      'http://127.0.0.1:18888'
    )
  })
})
