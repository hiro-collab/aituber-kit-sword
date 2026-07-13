import { aiServiceOptions } from '@/components/settings/modelProvider/utils/aiServiceConfigs'

describe('settingsStore persistence', () => {
  const storageKey = 'aitube-kit-settings'
  const currentProviders = aiServiceOptions.map(({ value }) => value)
  const envOverrideProviders = currentProviders.filter(
    (provider) => provider !== 'thought-core'
  )
  const managedEnvNames = [
    'NEXT_PUBLIC_SELECTED_VRM_PATH',
    'NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES',
    'NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH',
    'NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE',
    'NEXT_PUBLIC_SELECT_AI_SERVICE',
    'NEXT_PUBLIC_THOUGHT_CORE_BASE_URL',
    'NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE',
  ] as const
  const originalEnv = Object.fromEntries(
    managedEnvNames.map((name) => [name, process.env[name]])
  )

  const loadStore = () => {
    jest.resetModules()
    return require('@/features/stores/settings').default
  }

  const setPersistedState = (state: Record<string, unknown>, version = 1) => {
    localStorage.setItem(storageKey, JSON.stringify({ state, version }))
  }

  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) {
      delete process.env[name]
      return
    }
    process.env[name] = value
  }

  beforeEach(() => {
    managedEnvNames.forEach((name) => delete process.env[name])
  })

  afterEach(() => {
    localStorage.clear()
    managedEnvNames.forEach((name) => restoreEnv(name, originalEnv[name]))
  })

  it.each(currentProviders)('persists and rehydrates %s', async (provider) => {
    setPersistedState({
      selectAIService: provider,
      characterName: `character-for-${provider}`,
    })

    const settingsStore = loadStore()
    await settingsStore.persist.rehydrate()

    expect(settingsStore.getState()).toMatchObject({
      selectAIService: provider,
      characterName: `character-for-${provider}`,
    })
    expect(
      JSON.parse(localStorage.getItem(storageKey) || '{}').state
    ).toMatchObject({
      selectAIService: provider,
      characterName: `character-for-${provider}`,
    })
  })

  it('prefers environment values before components read the store when override is enabled', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/nikechan_v2.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'true'
    setPersistedState({ selectedVrmPath: '/vrm/nikechan_v1.vrm' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectedVrmPath).toBe(
      '/vrm/nikechan_v2.vrm'
    )
  })

  it('keeps persisted values when override is disabled', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/nikechan_v2.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'
    setPersistedState({ selectedVrmPath: '/vrm/nikechan_v1.vrm' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectedVrmPath).toBe(
      '/vrm/nikechan_v1.vrm'
    )
  })

  it.each(envOverrideProviders)(
    'uses configured current provider %s only when full env override is enabled',
    (provider) => {
      process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'true'
      process.env.NEXT_PUBLIC_SELECT_AI_SERVICE = provider
      setPersistedState({
        selectAIService: provider === 'openai' ? 'anthropic' : 'openai',
      })

      const settingsStore = loadStore()

      expect(settingsStore.getState().selectAIService).toBe(provider)
    }
  )

  it('does not apply a configured provider when full env override is disabled', () => {
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'
    process.env.NEXT_PUBLIC_SELECT_AI_SERVICE = 'anthropic'
    setPersistedState({ selectAIService: 'openai' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectAIService).toBe('openai')
  })

  it('resets persisted camera calibration when a forced VRM path changes the model', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/custom_model.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH = 'true'
    setPersistedState({
      selectedVrmPath: '/vrm/nikechan_v1.vrm',
      fixedCharacterPosition: true,
      characterPosition: { x: 0.2, y: 1.45, z: 1.9, scale: 1 },
      characterRotation: { x: 0, y: 1.42, z: 0 },
    })

    const settingsStore = loadStore()

    expect(settingsStore.getState()).toMatchObject({
      selectedVrmPath: '/vrm/custom_model.vrm',
      fixedCharacterPosition: false,
      characterPosition: { x: 0, y: 0, z: 0, scale: 1 },
      characterRotation: { x: 0, y: 0, z: 0 },
    })
  })

  it('preserves camera calibration when a forced VRM path keeps the same model', () => {
    process.env.NEXT_PUBLIC_SELECTED_VRM_PATH = '/vrm/custom_model.vrm'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'false'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_SELECTED_VRM_PATH = 'true'
    setPersistedState({
      selectedVrmPath: '/vrm/custom_model.vrm',
      fixedCharacterPosition: true,
      characterPosition: { x: 0.2, y: 1.45, z: 1.9, scale: 1 },
      characterRotation: { x: 0, y: 1.42, z: 0 },
    })

    const settingsStore = loadStore()

    expect(settingsStore.getState()).toMatchObject({
      selectedVrmPath: '/vrm/custom_model.vrm',
      fixedCharacterPosition: true,
      characterPosition: { x: 0.2, y: 1.45, z: 1.9, scale: 1 },
      characterRotation: { x: 0, y: 1.42, z: 0 },
    })
  })

  it('System Cell forces Thought Core across a contradictory full env override', () => {
    process.env.NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE = 'thought-core'
    process.env.NEXT_PUBLIC_SELECT_AI_SERVICE = 'openai'
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'true'
    process.env.NEXT_PUBLIC_THOUGHT_CORE_BASE_URL = 'http://127.0.0.1:18888'
    setPersistedState({
      selectAIService: 'anthropic',
      thoughtCoreUrl: 'http://127.0.0.1:18787',
    })

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectAIService).toBe('thought-core')
    expect(settingsStore.getState().thoughtCoreUrl).toBe(
      'http://127.0.0.1:18888'
    )
  })

  it('does not use Projection Visual AI service env as a System Cell provider fallback', () => {
    process.env.NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE = 'thought-core'
    setPersistedState({ selectAIService: 'openai' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().selectAIService).toBe('openai')
  })

  it('retains a stale unsupported provider for fail-closed runtime handling', async () => {
    setPersistedState({
      selectAIService: 'stale-provider',
      characterName: 'preserved-character',
    })

    const settingsStore = loadStore()
    await settingsStore.persist.rehydrate()
    const { getAIChatResponseStream } = require('@/features/chat/aiChatFactory')

    expect(settingsStore.getState()).toMatchObject({
      selectAIService: 'stale-provider',
      characterName: 'preserved-character',
    })
    await expect(getAIChatResponseStream([])).rejects.toThrow(
      'Unsupported AI service: stale-provider'
    )
  })

  it('normalizes legacy persisted Dify state once and removes its keys', async () => {
    setPersistedState(
      {
        selectAIService: 'dify',
        difyKey: 'synthetic-marker-key',
        difyUrl: 'synthetic-marker-url',
        difyConversationId: 'synthetic-marker-conversation',
        characterName: 'persisted-character',
      },
      0
    )

    const settingsStore = loadStore()
    await settingsStore.persist.rehydrate()
    const state = settingsStore.getState()

    expect(state.selectAIService).toBe('thought-core')
    expect(state.characterName).toBe('persisted-character')
    expect(state).not.toHaveProperty('difyKey')
    expect(state).not.toHaveProperty('difyUrl')
    expect(state).not.toHaveProperty('difyConversationId')

    const serializedPersistedState = localStorage.getItem(storageKey) || ''
    const persisted = JSON.parse(serializedPersistedState)

    expect(persisted.version).toBe(1)
    expect(persisted.state.selectAIService).toBe('thought-core')
    expect(persisted.state.characterName).toBe('persisted-character')
    expect(persisted.state).not.toHaveProperty('difyKey')
    expect(persisted.state).not.toHaveProperty('difyUrl')
    expect(persisted.state).not.toHaveProperty('difyConversationId')
    expect(serializedPersistedState).not.toContain('synthetic-marker-key')
    expect(serializedPersistedState).not.toContain('synthetic-marker-url')
    expect(serializedPersistedState).not.toContain(
      'synthetic-marker-conversation'
    )
  })
})
