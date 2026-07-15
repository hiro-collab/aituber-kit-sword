import { aiServiceOptions } from '@/components/settings/modelProvider/utils/aiServiceConfigs'
import { DEFAULT_SPEECH_BUBBLE_PRESENTATION } from '@/features/projectionVisualBubble/presentation'
import {
  DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
  DEFAULT_PROJECTION_EFFECTS_SETTINGS,
} from '@/features/projectionEffects/settings'

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
    'NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV',
    'NEXT_PUBLIC_LIGHTING_INTENSITY',
    'NEXT_PUBLIC_PROJECTION_EFFECT_ID',
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

  it('rehydrates a valid persisted projector horizontal FOV', () => {
    process.env.NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV = '30'
    setPersistedState({ cameraHorizontalFov: 45 })

    const settingsStore = loadStore()

    expect(settingsStore.getState().cameraHorizontalFov).toBe(45)
  })

  it('keeps the validated environment FOV when persistence omits it', () => {
    process.env.NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV = '30'
    setPersistedState({ characterName: 'camera-fov-missing' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().cameraHorizontalFov).toBe(30)
  })

  it.each([
    ['numeric string', '45'],
    ['object', { value: 45 }],
    ['null', null],
    ['below minimum', 19],
    ['above maximum', 91],
  ])(
    'rejects an invalid persisted projector FOV: %s',
    (_label, persistedValue) => {
      process.env.NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV = '30'
      setPersistedState({ cameraHorizontalFov: persistedValue })

      const settingsStore = loadStore()

      expect(settingsStore.getState().cameraHorizontalFov).toBe(30)
    }
  )

  it.each(['179', 'Infinity', 'NaN'])(
    'fails closed to the default for an invalid environment FOV: %s',
    (environmentValue) => {
      process.env.NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV = environmentValue
      setPersistedState({ characterName: 'invalid-env-fov' })

      const settingsStore = loadStore()

      expect(settingsStore.getState().cameraHorizontalFov).toBe(35)
    }
  )

  it('rehydrates a valid persisted projector lighting intensity', () => {
    process.env.NEXT_PUBLIC_LIGHTING_INTENSITY = '1.2'
    setPersistedState({ lightingIntensity: 2.4 })

    const settingsStore = loadStore()

    expect(settingsStore.getState().lightingIntensity).toBe(2.4)
  })

  it('rehydrates the complete bounded local projection effect settings', () => {
    const persisted = {
      selectedEffect: 'fluidFireRelay',
      fluidFireRelay: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        densityGain: 1.2,
      },
    }
    setPersistedState({ projectionEffects: persisted })

    const settingsStore = loadStore()

    expect(settingsStore.getState().projectionEffects).toEqual(persisted)
  })

  it.each([
    [
      'unknown effect',
      { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS, selectedEffect: 'url' },
    ],
    [
      'extra key',
      { ...DEFAULT_PROJECTION_EFFECTS_SETTINGS, arbitraryShader: 'raw' },
    ],
    [
      'incomplete parameters',
      {
        selectedEffect: 'fluidFireRelay',
        fluidFireRelay: { densityGain: 1 },
      },
    ],
    [
      'out of range',
      {
        selectedEffect: 'fluidFireRelay',
        fluidFireRelay: {
          ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
          bloomGain: 99,
        },
      },
    ],
  ])(
    'rejects invalid persisted projection effect settings: %s',
    (_label, value) => {
      setPersistedState({ projectionEffects: value })

      const settingsStore = loadStore()

      expect(settingsStore.getState().projectionEffects).toEqual(
        DEFAULT_PROJECTION_EFFECTS_SETTINGS
      )
    }
  )

  it('uses the bounded environment selection only as the initial local default', () => {
    process.env.NEXT_PUBLIC_PROJECTION_EFFECT_ID = 'fluidFireRelay'
    setPersistedState({ characterName: 'effect-env-default' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().projectionEffects.selectedEffect).toBe(
      'fluidFireRelay'
    )
  })

  it('fails an unknown environment effect selection closed to none', () => {
    process.env.NEXT_PUBLIC_PROJECTION_EFFECT_ID = 'https://example.test/raw'
    setPersistedState({ characterName: 'invalid-effect-env' })

    const settingsStore = loadStore()

    expect(settingsStore.getState().projectionEffects).toEqual(
      DEFAULT_PROJECTION_EFFECTS_SETTINGS
    )
  })

  it('rehydrates the complete bounded local speech bubble presentation', () => {
    const persisted = {
      ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      fontSizePx: 30,
      timingMode: 'reading-time',
    }
    setPersistedState({ speechBubblePresentation: persisted })

    const settingsStore = loadStore()

    expect(settingsStore.getState().speechBubblePresentation).toEqual(persisted)
  })

  it('keeps operator-owned projection calibration local during a full environment override', () => {
    process.env.NEXT_PUBLIC_ALWAYS_OVERRIDE_WITH_ENV_VARIABLES = 'true'
    process.env.NEXT_PUBLIC_CAMERA_HORIZONTAL_FOV = '30'
    process.env.NEXT_PUBLIC_LIGHTING_INTENSITY = '1'
    process.env.NEXT_PUBLIC_PROJECTION_EFFECT_ID = 'none'
    const persistedBubble = {
      ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
      fontSizePx: 28,
      timingMode: 'reading-time' as const,
    }
    const persistedEffects = {
      selectedEffect: 'fluidFireRelay' as const,
      fluidFireRelay: {
        ...DEFAULT_FLUID_FIRE_RELAY_PARAMETERS,
        bloomGain: 1.4,
      },
    }
    setPersistedState({
      cameraHorizontalFov: 45,
      lightingIntensity: 2.2,
      projectionEffects: persistedEffects,
      speechBubblePresentation: persistedBubble,
    })

    const settingsStore = loadStore()

    expect(settingsStore.getState()).toMatchObject({
      cameraHorizontalFov: 45,
      lightingIntensity: 2.2,
      projectionEffects: persistedEffects,
      speechBubblePresentation: persistedBubble,
    })
  })

  it.each([
    ['partial', { fontSizePx: 30 }],
    [
      'extra key',
      {
        ...DEFAULT_SPEECH_BUBBLE_PRESENTATION,
        arbitraryCss: 'display:none',
      },
    ],
    ['out of range', { ...DEFAULT_SPEECH_BUBBLE_PRESENTATION, positionX: 2 }],
  ])('rejects invalid persisted bubble presentation: %s', (_label, value) => {
    setPersistedState({ speechBubblePresentation: value })

    const settingsStore = loadStore()

    expect(settingsStore.getState().speechBubblePresentation).toEqual(
      DEFAULT_SPEECH_BUBBLE_PRESENTATION
    )
  })

  it.each([
    ['numeric string', '1.5'],
    ['object', { value: 1.5 }],
    ['null', null],
    ['not finite', Number.POSITIVE_INFINITY],
    ['zero', 0],
    ['below minimum', 0.09],
    ['above maximum', 3.01],
  ])(
    'rejects an invalid persisted projector lighting value: %s',
    (_label, persistedValue) => {
      process.env.NEXT_PUBLIC_LIGHTING_INTENSITY = '1.2'
      setPersistedState({ lightingIntensity: persistedValue })

      const settingsStore = loadStore()

      expect(settingsStore.getState().lightingIntensity).toBe(1.2)
    }
  )

  it.each(['0', '3.01', 'Infinity', 'NaN', '1.2x'])(
    'fails closed to the default for an invalid environment lighting value: %s',
    (environmentValue) => {
      process.env.NEXT_PUBLIC_LIGHTING_INTENSITY = environmentValue
      setPersistedState({ characterName: 'invalid-env-lighting' })

      const settingsStore = loadStore()

      expect(settingsStore.getState().lightingIntensity).toBe(1)
    }
  )

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
