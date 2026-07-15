import {
  isFailClosedMappingStatus,
  type ProjectionEffectDefinition,
} from '../canonical/types'
import {
  validateProjectionEffectDefinition,
  validateProjectionEffectParameterValues,
} from '../canonical/validation'
import {
  createDefaultProjectionEffectRegistry,
  ProjectionEffectRegistry,
  ProjectionEffectSessionCreationError,
} from '../registry'
import type {
  ProjectionEffectRenderer,
  ProjectionEffectRendererPlugin,
  ProjectionEffectSession,
} from '../rendererPlugin'
import { summarizeTouchDesignerMapping } from '../adapters/touchDesigner/mappingTypes'
import {
  FLUID_FIRE_RELAY_EFFECT_ID,
  fluidFireRelayDefinition,
} from '../plugins/fluidFireRelay/definition'
import {
  fluidFireRelayPassGraph,
  fluidFireRelayTouchDesignerMapping,
} from '../plugins/fluidFireRelay/mapping'
import { FluidFireRelayRenderer } from '../plugins/fluidFireRelay/renderer'

const VALID_PARAMETERS = {
  densityGain: 0.7,
  temperatureGain: 0.9,
  velocityDissipation: 0.98,
  relayMix: 0.6,
  bloomGain: 0.3,
}

describe('canonical Projection Effects validation', () => {
  it('accepts the source-static registered definition and rejects unsafe ids and URLs', () => {
    expect(
      validateProjectionEffectDefinition(fluidFireRelayDefinition)
    ).toEqual({ ok: true, value: fluidFireRelayDefinition })

    const unsafeId = cloneDefinition()
    unsafeId.id = '../fluid'
    expect(validateProjectionEffectDefinition(unsafeId).ok).toBe(false)

    const urlBinding = cloneDefinition()
    urlBinding.calibrationBinding.calibrationId = 'https://private.invalid/x'
    expect(validateProjectionEffectDefinition(urlBinding).ok).toBe(false)

    const unknownParameterMapping = cloneDefinition()
    unknownParameterMapping.sourceMappings[0].parameterId = 'notDeclared'
    expect(validateProjectionEffectDefinition(unknownParameterMapping).ok).toBe(
      false
    )
  })

  it.each([
    ['ready', 'source-static'],
    ['running', 'source-static'],
    ['registered', 'runtime-observed'],
    ['registered', 'not-proven'],
  ] as const)(
    'rejects lifecycle=%s and proof=%s at plugin registration',
    (lifecycle, proofStatus) => {
      const definition = cloneDefinition()
      definition.lifecycle = lifecycle
      definition.proofStatus = proofStatus
      expect(validateProjectionEffectDefinition(definition).ok).toBe(false)
    }
  )

  it('rejects raw shader payloads, unknown fields, and out-of-range parameters', () => {
    const rawShader = {
      ...cloneDefinition(),
      shaderSource: 'void main() { gl_FragColor = vec4(1.0); }',
    }
    const shaderResult = validateProjectionEffectDefinition(rawShader)
    expect(shaderResult.ok).toBe(false)
    if (!shaderResult.ok) {
      expect(shaderResult.errors).toContain(
        'definition.shaderSource is not allowed'
      )
    }

    expect(
      validateProjectionEffectParameterValues(
        fluidFireRelayDefinition.parameters,
        { ...VALID_PARAMETERS, densityGain: 2.1 }
      )
    ).toContain('parameter.densityGain is out of range')

    const privateLikeKey = 'private://raw-provider-payload'
    const errors = validateProjectionEffectParameterValues(
      fluidFireRelayDefinition.parameters,
      { ...VALID_PARAMETERS, [privateLikeKey]: 'raw' }
    )
    expect(errors).toContain('parameter.undeclared is not allowed')
    expect(JSON.stringify(errors)).not.toContain(privateLikeKey)
  })

  it('rejects duplicate diagnostic, capability, and source ownership', () => {
    const diagnostic = cloneDefinition()
    diagnostic.diagnostics = [
      ...diagnostic.diagnostics,
      { code: diagnostic.diagnostics[0].code, status: 'degraded' },
    ]
    expect(validateProjectionEffectDefinition(diagnostic).ok).toBe(false)

    const capability = cloneDefinition()
    capability.capabilities = [
      ...capability.capabilities,
      { id: capability.capabilities[0].id, available: false },
    ]
    expect(validateProjectionEffectDefinition(capability).ok).toBe(false)

    const sourceMapping = cloneDefinition()
    sourceMapping.sourceMappings = [
      ...sourceMapping.sourceMappings,
      {
        sourceId: sourceMapping.sourceMappings[0].sourceId,
        parameterId: 'temperatureGain',
        status: 'mapped',
      },
    ]
    expect(validateProjectionEffectDefinition(sourceMapping).ok).toBe(false)

    const sharedTarget = cloneDefinition()
    sharedTarget.sourceMappings[1].parameterId =
      sharedTarget.sourceMappings[0].parameterId
    expect(validateProjectionEffectDefinition(sharedTarget).ok).toBe(true)
  })

  it('locks the source-static proof ceiling in capability data', () => {
    expect(fluidFireRelayDefinition.proofStatus).toBe('source-static')
    expect(fluidFireRelayDefinition.capabilities).toEqual([
      { id: 'browserRendererContract', available: true },
      { id: 'avatarLightingContribution', available: true },
      { id: 'browserRuntimeObserved', available: false },
      { id: 'touchDesignerWriteback', available: false },
    ])
  })
})

describe('mapping status and registry ownership', () => {
  it('preserves all mapping status classes and fails closed for unknown/ambiguous', () => {
    expect(isFailClosedMappingStatus('unknown')).toBe(true)
    expect(isFailClosedMappingStatus('ambiguous')).toBe(true)
    expect(isFailClosedMappingStatus('unsupported')).toBe(false)
    expect(isFailClosedMappingStatus('intentional-difference')).toBe(false)

    const summary = summarizeTouchDesignerMapping({
      schemaVersion: 1,
      effectId: FLUID_FIRE_RELAY_EFFECT_ID,
      parameters: [
        ...fluidFireRelayTouchDesignerMapping.parameters,
        {
          touchDesignerParameterId: 'missingInput',
          browserParameterId: 'densityGain',
          status: 'missing',
        },
        {
          touchDesignerParameterId: 'ambiguousInput',
          browserParameterId: 'densityGain',
          status: 'ambiguous',
        },
        {
          touchDesignerParameterId: 'unknownInput',
          browserParameterId: 'densityGain',
          status: 'unknown',
        },
      ],
    })
    expect(summary).toEqual({
      mapped: 2,
      missing: 1,
      ambiguous: 1,
      unsupported: 1,
      'intentional-difference': 1,
      unknown: 1,
    })
  })

  it('registers only fluidFireRelay by default and rejects duplicate ownership', () => {
    const registry = createDefaultProjectionEffectRegistry()
    expect(registry.listEffectIds()).toEqual([FLUID_FIRE_RELAY_EFFECT_ID])
    expect(registry.has(FLUID_FIRE_RELAY_EFFECT_ID)).toBe(true)
    expect(() =>
      registry.register(pluginFor(cloneDefinition(), mockRenderer()))
    ).toThrow('projection effect id is already owned')
  })

  it('owns an immutable definition and renderer-factory snapshot', async () => {
    const definition = cloneDefinition()
    const originalId = definition.id
    const firstRenderer = mockRenderer()
    const replacementRenderer = mockRenderer()
    const plugin = pluginFor(definition, firstRenderer)
    const registry = new ProjectionEffectRegistry()
    registry.register(plugin)

    const mutableNumberParameter = definition.parameters[0]
    if (mutableNumberParameter.kind !== 'number') {
      throw new Error('test fixture must begin with a number parameter')
    }
    definition.id = 'mutatedAfterRegistration'
    definition.lifecycle = 'running'
    definition.proofStatus = 'runtime-observed'
    mutableNumberParameter.maximum = 99
    definition.sourceMappings[0].status = 'unknown'
    plugin.createRenderer = () => replacementRenderer

    expect(registry.listEffectIds()).toEqual([originalId])
    const session = registry.createSession(originalId)
    expect(session.definition.id).toBe(originalId)
    expect(session.definition.lifecycle).toBe('registered')
    expect(session.definition.proofStatus).toBe('source-static')
    const snapshotNumberParameter = session.definition.parameters[0]
    expect(snapshotNumberParameter.kind).toBe('number')
    if (snapshotNumberParameter.kind !== 'number') {
      throw new Error('registry snapshot changed the parameter kind')
    }
    expect(snapshotNumberParameter.maximum).toBe(2)
    expect(session.definition.sourceMappings[0].status).toBe('mapped')
    expect(Object.isFrozen(session.definition)).toBe(true)
    expect(Object.isFrozen(session.definition.parameters)).toBe(true)
    expect(Object.isFrozen(session.definition.parameters[0])).toBe(true)

    expect((await session.start()).status).toBe('started')
    await session.update(frame())
    expect(firstRenderer.render).toHaveBeenCalledTimes(1)
    expect(replacementRenderer.render).not.toHaveBeenCalled()
  })

  it('contains createRenderer failures behind one fixed public error', () => {
    const privateMessage = 'private://renderer/factory/C:/secret/model.vrm'
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: cloneDefinition(),
      createRenderer: () => {
        throw new Error(privateMessage)
      },
    })

    try {
      registry.createSession(FLUID_FIRE_RELAY_EFFECT_ID)
      throw new Error('expected createSession to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectionEffectSessionCreationError)
      expect(error).toEqual(
        expect.objectContaining({
          name: 'ProjectionEffectSessionCreationError',
          code: 'projection-effect-renderer-create-failed',
          message: 'projection effect renderer creation failed',
        })
      )
      expect(String(error)).not.toContain(privateMessage)
    }
  })

  it.each(['unknown', 'ambiguous'] as const)(
    'blocks runtime start when a source mapping is %s',
    async (status) => {
      const definition = cloneDefinition()
      definition.sourceMappings[0].status = status
      const session = createSessionFor(definition, mockRenderer())
      await expect(session.start()).resolves.toEqual({
        status: 'blocked-mapping',
        lifecycle: 'suspended',
        parameterErrorCount: 0,
      })
    }
  )
})

describe('fluidFireRelay renderer lifecycle', () => {
  it('keeps pressure, relay, bloom, and pass graph semantics plugin-local', async () => {
    expect(fluidFireRelayPassGraph.map((pass) => pass.kind)).toEqual([
      'velocity-advection',
      'pressure-divergence',
      'pressure-relaxation',
      'density-advection',
      'temperature-advection',
      'relay-blend',
      'bloom',
      'composite',
    ])

    const renderer = new FluidFireRelayRenderer()
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    await session.update(frame())
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({
        disposed: false,
        frameCount: 1,
        completedPassCount: fluidFireRelayPassGraph.length,
      })
    )
    expect(renderer.snapshot().densityEnergy).toBeGreaterThan(0)
    expect(renderer.snapshot().temperatureEnergy).toBeGreaterThan(0)

    await session.reset()
    expect(renderer.snapshot().frameCount).toBe(0)
    expect(renderer.snapshot().completedPassCount).toBe(0)
    await session.dispose()
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({
        disposed: true,
        densityEnergy: 0,
        temperatureEnergy: 0,
        pressureEnergy: 0,
      })
    )
  })

  it('validates parameters before rendering and exposes reset/dispose states', async () => {
    const renderer = new FluidFireRelayRenderer()
    const session = createSessionFor(cloneDefinition(), renderer)
    expect((await session.start()).status).toBe('started')

    await expect(
      session.update(frame({ ...VALID_PARAMETERS, relayMix: 4 }))
    ).resolves.toEqual({
      status: 'invalid-parameters',
      lifecycle: 'running',
      parameterErrorCount: 1,
    })
    expect(renderer.snapshot().frameCount).toBe(0)
    await expect(session.reset()).resolves.toEqual({
      status: 'reset',
      lifecycle: 'ready',
      parameterErrorCount: 0,
    })
    expect((await session.start()).status).toBe('started')
    await expect(session.dispose()).resolves.toEqual({
      status: 'disposed',
      lifecycle: 'disposed',
      parameterErrorCount: 0,
    })
    await expect(session.update(frame())).resolves.toEqual({
      status: 'ignored-disposed',
      lifecycle: 'disposed',
      parameterErrorCount: 0,
    })
  })

  it.each([
    { nowMs: Number.NaN, deltaMs: 16 },
    { nowMs: Number.POSITIVE_INFINITY, deltaMs: 16 },
    { nowMs: -1, deltaMs: 16 },
    { nowMs: 10_000_000_000_001, deltaMs: 16 },
    { nowMs: 1000, deltaMs: Number.POSITIVE_INFINITY },
    { nowMs: 1000, deltaMs: -1 },
    { nowMs: 1000, deltaMs: 1001 },
  ])('rejects invalid frame timing without rendering: %p', async (timing) => {
    const renderer = mockRenderer()
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    await expect(
      session.update({ ...timing, parameters: VALID_PARAMETERS })
    ).resolves.toEqual({
      status: 'invalid-timing',
      lifecycle: 'running',
      parameterErrorCount: 0,
    })
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('waits for a prior render before reset and permits no later side effect', async () => {
    const events: string[] = []
    const gate = deferred()
    const renderer = mockRenderer({
      render: jest.fn(async () => {
        events.push('render-start')
        await gate.promise
        events.push('render-end')
      }),
      reset: jest.fn(() => {
        events.push('reset')
      }),
    })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    const update = session.update(frame())
    await Promise.resolve()
    const reset = session.reset()
    await Promise.resolve()
    expect(events).toEqual(['render-start'])
    gate.resolve()
    await update
    await expect(reset).resolves.toEqual(
      expect.objectContaining({ status: 'reset', lifecycle: 'ready' })
    )
    expect(events).toEqual(['render-start', 'render-end', 'reset'])
  })

  it('waits for a prior render before dispose and permits no later side effect', async () => {
    const events: string[] = []
    const gate = deferred()
    const renderer = mockRenderer({
      render: jest.fn(async () => {
        events.push('render-start')
        await gate.promise
        events.push('render-end')
      }),
      dispose: jest.fn(() => {
        events.push('dispose')
      }),
    })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    const update = session.update(frame())
    await Promise.resolve()
    const dispose = session.dispose()
    await Promise.resolve()
    expect(events).toEqual(['render-start'])
    gate.resolve()
    await update
    await expect(dispose).resolves.toEqual(
      expect.objectContaining({ status: 'disposed', lifecycle: 'disposed' })
    )
    expect(events).toEqual(['render-start', 'render-end', 'dispose'])
    await session.update(frame())
    expect(events).toEqual(['render-start', 'render-end', 'dispose'])
  })

  it('serializes concurrent updates', async () => {
    const events: string[] = []
    const firstGate = deferred()
    let callCount = 0
    const renderer = mockRenderer({
      render: jest.fn(async () => {
        callCount += 1
        const current = callCount
        events.push(`render-${current}-start`)
        if (current === 1) await firstGate.promise
        events.push(`render-${current}-end`)
      }),
    })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    const first = session.update(frame())
    const second = session.update(frame())
    await Promise.resolve()
    expect(events).toEqual(['render-1-start'])
    firstGate.resolve()
    await Promise.all([first, second])
    expect(events).toEqual([
      'render-1-start',
      'render-1-end',
      'render-2-start',
      'render-2-end',
    ])
  })

  it('serializes start requested during reset', async () => {
    const events: string[] = []
    const gate = deferred()
    const renderer = mockRenderer({
      reset: jest.fn(async () => {
        events.push('reset-start')
        await gate.promise
        events.push('reset-end')
      }),
    })
    const session = createSessionFor(cloneDefinition(), renderer)
    const reset = session.reset()
    await Promise.resolve()
    let startSettled = false
    const start = session.start().then((result) => {
      startSettled = true
      return result
    })
    await Promise.resolve()
    expect(events).toEqual(['reset-start'])
    expect(startSettled).toBe(false)

    gate.resolve()
    await expect(reset).resolves.toEqual(
      expect.objectContaining({ status: 'reset', lifecycle: 'ready' })
    )
    await expect(start).resolves.toEqual(
      expect.objectContaining({ status: 'started', lifecycle: 'running' })
    )
    expect(session.lifecycle).toBe('running')
    expect(events).toEqual(['reset-start', 'reset-end'])
  })

  it('rejects start requested during dispose', async () => {
    const events: string[] = []
    const gate = deferred()
    const renderer = mockRenderer({
      dispose: jest.fn(async () => {
        events.push('dispose-start')
        await gate.promise
        events.push('dispose-end')
      }),
    })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()
    const dispose = session.dispose()
    await Promise.resolve()
    let startSettled = false
    const start = session.start().then((result) => {
      startSettled = true
      return result
    })
    await Promise.resolve()
    expect(events).toEqual(['dispose-start'])
    expect(startSettled).toBe(false)

    gate.resolve()
    await expect(dispose).resolves.toEqual(
      expect.objectContaining({ status: 'disposed', lifecycle: 'disposed' })
    )
    await expect(start).resolves.toEqual(
      expect.objectContaining({
        status: 'ignored-disposed',
        lifecycle: 'disposed',
      })
    )
    expect(events).toEqual(['dispose-start', 'dispose-end'])
  })

  it('contains render failures and permits explicit queue recovery', async () => {
    const privateMessage = 'private://render/C:/secret/shader.frag'
    const render = jest
      .fn<Promise<void> | void, []>()
      .mockRejectedValueOnce(new Error(privateMessage))
      .mockResolvedValueOnce()
    const renderer = mockRenderer({ render })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()

    const failure = await session.update(frame())
    expect(failure).toEqual({
      status: 'render-failed',
      lifecycle: 'suspended',
      parameterErrorCount: 0,
    })
    expect(JSON.stringify(failure)).not.toContain(privateMessage)
    await expect(session.update(frame())).resolves.toEqual(
      expect.objectContaining({ status: 'skipped-not-running' })
    )
    await expect(session.start()).resolves.toEqual(
      expect.objectContaining({ status: 'started', lifecycle: 'running' })
    )
    await expect(session.update(frame())).resolves.toEqual(
      expect.objectContaining({ status: 'rendered', lifecycle: 'running' })
    )
    expect(render).toHaveBeenCalledTimes(2)
  })

  it('contains reset failures and permits explicit queue recovery', async () => {
    const privateMessage = 'private://reset/C:/secret/calibration.json'
    const reset = jest
      .fn<Promise<void> | void, []>()
      .mockRejectedValueOnce(new Error(privateMessage))
      .mockResolvedValueOnce()
    const renderer = mockRenderer({ reset })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()

    const failure = await session.reset()
    expect(failure).toEqual({
      status: 'reset-failed',
      lifecycle: 'suspended',
      parameterErrorCount: 0,
    })
    expect(JSON.stringify(failure)).not.toContain(privateMessage)
    await expect(session.start()).resolves.toEqual(
      expect.objectContaining({ status: 'started', lifecycle: 'running' })
    )
    await expect(session.reset()).resolves.toEqual(
      expect.objectContaining({ status: 'reset', lifecycle: 'ready' })
    )
    expect(reset).toHaveBeenCalledTimes(2)
  })

  it('contains dispose failures and remains irreversibly disposed', async () => {
    const privateMessage = 'private://dispose/C:/secret/texture.bin'
    const dispose = jest.fn().mockRejectedValue(new Error(privateMessage))
    const renderer = mockRenderer({ dispose })
    const session = createSessionFor(cloneDefinition(), renderer)
    await session.start()

    const failure = await session.dispose()
    expect(failure).toEqual({
      status: 'dispose-failed',
      lifecycle: 'disposed',
      parameterErrorCount: 0,
    })
    expect(JSON.stringify(failure)).not.toContain(privateMessage)
    await expect(session.start()).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    await expect(session.update(frame())).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    await expect(session.reset()).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    await expect(session.dispose()).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    expect(renderer.render).not.toHaveBeenCalled()
    expect(renderer.reset).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

function pluginFor(
  definition: ProjectionEffectDefinition,
  renderer: ProjectionEffectRenderer
): ProjectionEffectRendererPlugin {
  return { definition, createRenderer: () => renderer }
}

function createSessionFor(
  definition: ProjectionEffectDefinition,
  renderer: ProjectionEffectRenderer
): ProjectionEffectSession {
  const registry = new ProjectionEffectRegistry()
  registry.register(pluginFor(definition, renderer))
  return registry.createSession(definition.id)
}

function mockRenderer(
  overrides: Partial<ProjectionEffectRenderer> = {}
): ProjectionEffectRenderer {
  return {
    render: jest.fn(),
    reset: jest.fn(),
    dispose: jest.fn(),
    ...overrides,
  }
}

function frame(
  parameters: Readonly<Record<string, unknown>> = VALID_PARAMETERS
) {
  return { nowMs: 1000, deltaMs: 16, parameters }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function cloneDefinition(): ProjectionEffectDefinition {
  return JSON.parse(
    JSON.stringify(fluidFireRelayDefinition)
  ) as ProjectionEffectDefinition
}
