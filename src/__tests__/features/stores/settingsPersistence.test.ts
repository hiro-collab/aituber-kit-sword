describe('settingsStore persistence', () => {
  const storageKey = 'aitube-kit-settings'
  const originalSelectedVrmPath = process.env.NEXT_PUBLIC_SELECTED_VRM_PATH
  const originalAlwaysOverride =
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES
  const originalAlwaysOverrideSelectedVrmPath =
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH
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
      'NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH',
      originalAlwaysOverrideSelectedVrmPath
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

  it('can force only the selected VRM path while preserving persisted camera position', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/custom_model.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH = 'true'

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        state: {
          selectedVrmPath: '/vrm/nikechan_v1.vrm',
          fixedCharacterPosition: true,
          characterPosition: { x: 0.2, y: 1.45, z: 1.9, scale: 1 },
          characterRotation: { x: 0, y: 1.42, z: 0 },
        },
        version: 0,
      })
    )

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectedVrmPath).toBe('/vrm/custom_model.vrm')
    expect(settingsStore.getState().fixedCharacterPosition).toBe(true)
    expect(settingsStore.getState().characterPosition).toEqual({
      x: 0.2,
      y: 1.45,
      z: 1.9,
      scale: 1,
    })
    expect(settingsStore.getState().characterRotation).toEqual({
      x: 0,
      y: 1.42,
      z: 0,
    })
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
