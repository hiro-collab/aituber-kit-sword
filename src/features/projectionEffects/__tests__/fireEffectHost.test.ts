import type { ProjectionEffectDefinition } from '../canonical/types'
import { validateProjectionEffectCommand } from '../effectCommand'
import {
  normalizeProjectionEffectQualityPolicy,
  ProjectionEffectHost,
  type ProjectionEffectRuntimeCapabilities,
} from '../effectHost'
import { ProjectionEffectRegistry } from '../registry'
import type {
  ProjectionEffectRenderer,
  ProjectionEffectSession,
} from '../rendererPlugin'
import type {
  ProjectionEffectSfxCue,
  ProjectionEffectSfxPlayer,
} from '../sfxContract'
import { validateProjectionEffectSfxCue } from '../sfxContract'
import {
  FIRE_EFFECT_ID,
  fireEffectDefinition,
  fireEffectSfxCue,
} from '../plugins/fire/definition'
import {
  FireParticleRenderer,
  createFireParticlePlugin,
} from '../plugins/fire/renderer'
import {
  FIRE_COMPOSITE_FRAGMENT_SHADER,
  FIRE_PARTICLE_FRAGMENT_SHADER,
  FIRE_PARTICLE_VERTEX_SHADER,
} from '../plugins/fire/shaders'
import { fluidFireRelayDefinition } from '../plugins/fluidFireRelay/definition'

const READY_CAPABILITIES: ProjectionEffectRuntimeCapabilities = {
  webgl2Available: true,
  audioOutputAvailable: true,
  sfxAssetsAvailable: true,
  selfObservationAvailable: true,
}

describe('Projection Effects structured command boundary', () => {
  it('accepts a bounded fire start and rejects unknown or non-scalar payloads', () => {
    expect(validateProjectionEffectCommand(startCommand()).ok).toBe(true)
    expect(
      validateProjectionEffectCommand({
        ...startCommand(),
        transcript: 'private raw transcript',
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining(['command.fields.unexpected']),
      })
    )
    expect(
      validateProjectionEffectCommand(
        startCommand({ parameters: { noiseStrength: { raw: true } } })
      )
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining(['command.parameter_value.invalid']),
      })
    )
    expect(
      validateProjectionEffectCommand(
        startCommand({ parameters: { palette: 'private value with spaces' } })
      )
    ).toEqual(expect.objectContaining({ ok: false }))
  })

  it('accepts only own plain fields and freezes an owned null-prototype snapshot', () => {
    const inherited = Object.create(startCommand())
    expect(validateProjectionEffectCommand(inherited)).toEqual(
      expect.objectContaining({ ok: false })
    )

    const parameters: Record<string, unknown> = { constructor: 'safeValue' }
    const command = startCommand({ parameters })
    const validation = validateProjectionEffectCommand(command)
    if (!validation.ok || validation.value.action !== 'start') {
      throw new Error('command snapshot fixture must validate')
    }
    parameters['constructor'] = 'mutatedAfterValidation'
    expect(Object.getPrototypeOf(validation.value)).toBeNull()
    expect(Object.getPrototypeOf(validation.value.parameters)).toBeNull()
    expect(Object.isFrozen(validation.value)).toBe(true)
    expect(Object.isFrozen(validation.value.parameters)).toBe(true)
    expect(validation.value.parameters.constructor).toBe('safeValue')

    const protoKey = JSON.parse('{"__proto__":"unsafe"}') as Record<
      string,
      unknown
    >
    expect(
      validateProjectionEffectCommand(startCommand({ parameters: protoKey }))
    ).toEqual(expect.objectContaining({ ok: false }))
  })

  it('keeps fluidFireRelay identified as relay/state visualization', () => {
    expect(fluidFireRelayDefinition.id).toBe('fluidFireRelay')
    expect(fireEffectDefinition.id).toBe('fire')
    expect(fireEffectDefinition.id).not.toBe(fluidFireRelayDefinition.id)
  })

  it('returns only bounded fixed command validation classes', () => {
    const privateKeys = Object.fromEntries(
      Array.from({ length: 80 }, (_, index) => [
        `privateRawTranscript${index}${'x'.repeat(80)}`,
        'must-not-escape',
      ])
    )
    const validation = validateProjectionEffectCommand({
      ...startCommand(),
      ...privateKeys,
      parameters: Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `privateParameter${index}${'x'.repeat(80)}`,
          { raw: 'must-not-escape' },
        ])
      ),
    })
    expect(validation).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining([
          'command.fields.unexpected',
          'command.parameters.too_many',
        ]),
      })
    )
    if (validation.ok) throw new Error('private command fixture must fail')
    expect(validation.errors.length).toBeLessThanOrEqual(12)
    expect(JSON.stringify(validation.errors)).not.toContain('private')
    expect(JSON.stringify(validation.errors)).not.toContain('must-not-escape')
  })
})

describe('real fire particle plugin source/static contract', () => {
  it('simulates bounded finite-life upward particles and clears on fade stop', async () => {
    const renderer = new FireParticleRenderer({ waitFrame: async () => {} })
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fireEffectDefinition,
      createRenderer: () => renderer,
    })
    const session = registry.createSession(FIRE_EFFECT_ID)
    await expect(session.start()).resolves.toEqual(
      expect.objectContaining({ status: 'started' })
    )

    const parameters = defaultFireParameters({
      particleBudget: 64,
      emissionRate: 1200,
      lifetimeMs: 200,
    })
    await session.update({ nowMs: 1000, deltaMs: 100, parameters })
    const first = renderer.snapshot()
    expect(first.particleCount).toBe(64)
    expect(first.maximumParticleLifeMs).toBeGreaterThan(0)
    expect(first.maximumParticleLifeMs).toBeLessThanOrEqual(256)

    await session.update({ nowMs: 1300, deltaMs: 100, parameters })
    const second = renderer.snapshot()
    expect(second.oldestParticleAgeMs).toBeLessThanOrEqual(100)
    if (first.highestParticleY === null || second.highestParticleY === null) {
      throw new Error('fire test requires live particles')
    }
    expect(second.highestParticleY).toBeGreaterThan(first.highestParticleY)
    await expect(session.stop({ mode: 'fade', fadeMs: 180 })).resolves.toEqual(
      expect.objectContaining({ status: 'stopped', lifecycle: 'ready' })
    )
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({ particleCount: 0, lastStopMode: 'fade' })
    )
  })

  it('contains a WebGL2 point-sprite, radial flame, bloom, and composite surface', () => {
    expect(FIRE_PARTICLE_VERTEX_SHADER).toContain('#version 300 es')
    expect(FIRE_PARTICLE_VERTEX_SHADER).toContain('gl_PointSize')
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).toContain('gl_PointCoord')
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).toContain('bloomGain')
    expect(FIRE_PARTICLE_FRAGMENT_SHADER).not.toMatch(
      /smoothstep\((?:0\.72, 0\.02|1\.0, 0\.18|1\.0, 0\.55)/
    )
    expect(FIRE_COMPOSITE_FRAGMENT_SHADER).toContain('fireEmission')
    expect(FIRE_COMPOSITE_FRAGMENT_SHADER).toContain('fireBloom')
  })

  it('preserves backward compatibility when an older plugin has no stop method', async () => {
    const renderer: ProjectionEffectRenderer = {
      render: jest.fn(),
      reset: jest.fn(),
      dispose: jest.fn(),
    }
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fireEffectDefinition,
      createRenderer: () => renderer,
    })
    const session = registry.createSession(FIRE_EFFECT_ID)
    await session.start()
    await expect(session.stop({ mode: 'fade', fadeMs: 180 })).resolves.toEqual(
      expect.objectContaining({ status: 'stopped', lifecycle: 'ready' })
    )
    expect(renderer.reset).toHaveBeenCalledTimes(1)
  })

  it('keeps an aborted rejecting operation irreversibly disposed', async () => {
    const stopWait = deferred<void>()
    const renderer: ProjectionEffectRenderer = {
      render: jest.fn(),
      stop: jest.fn(async (context) => {
        await stopWait.promise
        if (context.signal?.aborted) throw new Error('aborted old stop')
      }),
      reset: jest.fn(),
      dispose: jest.fn(),
    }
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fireEffectDefinition,
      createRenderer: () => renderer,
    })
    const session = registry.createSession(FIRE_EFFECT_ID)
    await session.start()
    const stopped = session.stop({ mode: 'fade', fadeMs: 180 })
    await Promise.resolve()
    const terminated = session.terminate()
    stopWait.resolve()
    await expect(stopped).resolves.toEqual(
      expect.objectContaining({
        status: 'ignored-disposed',
        lifecycle: 'disposed',
      })
    )
    await expect(terminated).resolves.toEqual(
      expect.objectContaining({ status: 'disposed', lifecycle: 'disposed' })
    )
    await expect(session.start()).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    await expect(
      session.update({
        nowMs: 1000,
        deltaMs: 16,
        parameters: defaultFireParameters(),
      })
    ).resolves.toEqual(expect.objectContaining({ status: 'ignored-disposed' }))
    await expect(session.reset()).resolves.toEqual(
      expect.objectContaining({ status: 'ignored-disposed' })
    )
    await expect(
      session.stop({ mode: 'immediate', fadeMs: 0 })
    ).resolves.toEqual(expect.objectContaining({ status: 'ignored-disposed' }))
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  it('bounds a stalled fade wait and clears particles before returning', async () => {
    jest.useFakeTimers()
    try {
      const renderer = new FireParticleRenderer({
        waitFrame: () => new Promise<void>(() => {}),
      })
      const registry = new ProjectionEffectRegistry()
      registry.register({
        definition: fireEffectDefinition,
        createRenderer: () => renderer,
      })
      const session = registry.createSession(FIRE_EFFECT_ID)
      await session.start()
      await session.update({
        nowMs: 1000,
        deltaMs: 100,
        parameters: defaultFireParameters(),
      })
      const stopPromise = session.stop({ mode: 'fade', fadeMs: 180 })
      await jest.runAllTimersAsync()
      await expect(stopPromise).resolves.toEqual(
        expect.objectContaining({ status: 'stopped' })
      )
      expect(renderer.snapshot().particleCount).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('attempts surface disposal exactly once even when clear throws', () => {
    const surface = {
      draw: jest.fn(),
      clear: jest.fn(() => {
        throw new Error('private clear failure')
      }),
      dispose: jest.fn(),
    }
    const renderer = new FireParticleRenderer({ surface })
    expect(() => renderer.dispose()).toThrow('private clear failure')
    expect(surface.clear).toHaveBeenCalledTimes(1)
    expect(surface.dispose).toHaveBeenCalledTimes(1)
    expect(renderer.snapshot()).toEqual(
      expect.objectContaining({ disposed: true, particleCount: 0 })
    )
    renderer.render({
      nowMs: 1000,
      deltaMs: 16,
      parameters: defaultFireParameters(),
    })
    expect(surface.draw).not.toHaveBeenCalled()
  })
})

describe('generic Projection Effect host lifecycle', () => {
  it('starts visual and SFX, updates, fades, and remains retriggerable', async () => {
    const sfx = mockSfxPlayer()
    const renderer = new FireParticleRenderer({ waitFrame: async () => {} })
    let nowMs = 1000
    const host = createHost({
      sfx,
      renderer,
      nowMs: () => {
        nowMs += 17
        return nowMs
      },
    })

    await expect(host.dispatch(startCommand())).resolves.toEqual(
      expect.objectContaining({
        status: 'started',
        activeEffectId: FIRE_EFFECT_ID,
        visualStatus: 'rendered',
        sfxStatus: 'started',
      })
    )
    expect(sfx.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      sfx.start.mock.invocationCallOrder[0]
    )

    await expect(
      host.dispatch(updateCommand({ noiseStrength: 0.8 }))
    ).resolves.toEqual(
      expect.objectContaining({ status: 'updated', visualStatus: 'rendered' })
    )
    await expect(host.renderFrame()).resolves.toEqual(
      expect.objectContaining({
        status: 'frame-rendered',
        visualStatus: 'rendered',
      })
    )
    await expect(host.dispatch(stopCommand('normal'))).resolves.toEqual(
      expect.objectContaining({
        status: 'stopped',
        activeEffectId: null,
        fadeMs: 180,
        visualStatus: 'stopped',
        sfxStatus: 'stopped',
      })
    )
    expect(sfx.fadeOut).toHaveBeenCalledWith(fireEffectSfxCue, 180)
    await expect(
      host.dispatch(startCommand({ commandId: 'fire.start.two' }))
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'started',
        activeEffectId: FIRE_EFFECT_ID,
      })
    )
  })

  it('latches an emergency stop until an explicit reset', async () => {
    const host = createHost()
    await host.dispatch(startCommand())
    await expect(host.dispatch(stopCommand('emergency'))).resolves.toEqual(
      expect.objectContaining({
        status: 'emergency-stopped',
        activeEffectId: null,
        fadeMs: 0,
      })
    )
    await expect(
      host.dispatch(startCommand({ commandId: 'fire.start.blocked' }))
    ).resolves.toEqual(
      expect.objectContaining({ status: 'blocked-emergency-stop' })
    )
    await expect(host.dispatch(resetCommand())).resolves.toEqual(
      expect.objectContaining({ status: 'reset' })
    )
    await expect(
      host.dispatch(startCommand({ commandId: 'fire.start.afterReset' }))
    ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
  })

  it('does not allocate emergency latches for unknown effect ids', async () => {
    const registry = new ProjectionEffectRegistry()
    registry.register(createFireParticlePlugin({ waitFrame: async () => {} }))
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      nowMs: incrementingClock(),
    })

    for (let index = 0; index < 80; index += 1) {
      const effectId = `futureFire${index}`
      await expect(
        host.dispatch({
          ...stopCommand('emergency'),
          commandId: `unknown.stop.${index}`,
          effectId,
        })
      ).resolves.toEqual(expect.objectContaining({ status: 'unknown-effect' }))
      await expect(
        host.dispatch({
          ...resetCommand(),
          commandId: `unknown.reset.${index}`,
          effectId,
        })
      ).resolves.toEqual(expect.objectContaining({ status: 'unknown-effect' }))
    }

    const futureDefinition = cloneDefinition(fireEffectDefinition)
    futureDefinition.id = 'futureFire0'
    futureDefinition.layerBinding.layerId = 'projection.effect.futureFire0'
    registry.register({
      definition: futureDefinition,
      createRenderer: () =>
        new FireParticleRenderer({ waitFrame: async () => {} }),
    })
    await expect(
      host.dispatch(
        startCommand({
          commandId: 'future.fire.start',
          effectId: 'futureFire0',
        })
      )
    ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
  })

  it('updates only the named active effect and replaces without a hidden queue', async () => {
    const registry = new ProjectionEffectRegistry()
    registry.register(createFireParticlePlugin({ waitFrame: async () => {} }))
    const secondDefinition = cloneDefinition(fireEffectDefinition)
    secondDefinition.id = 'testWind'
    secondDefinition.layerBinding.layerId = 'projection.effect.testWind'
    registry.register({
      definition: secondDefinition,
      createRenderer: () =>
        new FireParticleRenderer({ waitFrame: async () => {} }),
    })
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      sfxPlayer: mockSfxPlayer(),
      sfxCues: [fireEffectSfxCue],
      nowMs: incrementingClock(),
    })

    await host.dispatch(startCommand())
    await expect(
      host.dispatch({
        ...updateCommand({ noiseStrength: 0.4 }),
        effectId: 'testWind',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'effect-mismatch',
        activeEffectId: FIRE_EFFECT_ID,
      })
    )
    await expect(
      host.dispatch(
        startCommand({
          commandId: 'wind.start.one',
          effectId: 'testWind',
        })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'started',
        replacedEffectId: FIRE_EFFECT_ID,
        activeEffectId: 'testWind',
      })
    )
  })

  it('blocks WebGL2 absence without substitution and reports other degraded readiness', async () => {
    const host = createHost({
      capabilities: {
        webgl2Available: false,
        audioOutputAvailable: false,
        sfxAssetsAvailable: false,
        selfObservationAvailable: false,
      },
    })
    expect(host.readiness(FIRE_EFFECT_ID)).toEqual({
      status: 'degraded',
      effectReady: false,
      warnings: [
        'webgl2-unavailable',
        'audio-output-unavailable',
        'sfx-assets-unavailable',
        'self-observation-unavailable',
      ],
    })
    await expect(host.dispatch(startCommand())).resolves.toEqual(
      expect.objectContaining({
        status: 'blocked-not-ready',
        activeEffectId: null,
      })
    )
  })

  it('continues visual output when TTS times out or SFX start fails', async () => {
    const sfx = mockSfxPlayer()
    let sideEffectActive = false
    sfx.start.mockImplementationOnce(async () => {
      sideEffectActive = true
      throw new Error('private audio backend detail')
    })
    sfx.terminate.mockImplementationOnce(async () => {
      sideEffectActive = false
    })
    const host = createHost({ sfx })
    const result = await host.dispatch(
      startCommand({
        speechCompletion: 'timeout',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        status: 'started',
        activeEffectId: FIRE_EFFECT_ID,
        visualStatus: 'rendered',
        sfxStatus: 'start-failed-cleaned',
        partialReasons: expect.arrayContaining([
          'tts-timeout',
          'sfx-start-failed',
        ]),
      })
    )
    expect(sideEffectActive).toBe(false)
    expect(sfx.terminate).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('private audio backend detail')
    await host.dispatch(stopCommand('normal'))
    expect(sfx.fadeOut).not.toHaveBeenCalled()
  })

  it('quarantines an SFX start whose terminal cleanup cannot be joined', async () => {
    jest.useFakeTimers()
    try {
      const sfx = mockSfxPlayer()
      sfx.start.mockRejectedValueOnce(new Error('private start failure'))
      sfx.terminate.mockImplementationOnce(() => new Promise<void>(() => {}))
      const host = createHost({ sfx })
      const resultPromise = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(1_250)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'blocked-terminal-cleanup',
          activeEffectId: FIRE_EFFECT_ID,
          sfxStatus: 'stop-failed',
          partialReasons: expect.arrayContaining([
            'sfx-start-failed',
            'sfx-start-cleanup-failed',
            'sfx-stop-failed',
          ]),
        })
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds SFX prepare and prevents an aborted late preparation side effect', async () => {
    jest.useFakeTimers()
    try {
      const sfx = mockSfxPlayer()
      const preparation = deferred<void>()
      let latePreparationSideEffect = false
      sfx.prepare.mockImplementationOnce(async (_cue, signal) => {
        await preparation.promise
        if (!signal.aborted) latePreparationSideEffect = true
      })
      const host = createHost({ sfx })
      const resultPromise = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(1_000)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'started',
          sfxStatus: 'prepare-failed',
          partialReasons: expect.arrayContaining(['sfx-prepare-failed']),
        })
      )
      preparation.resolve()
      await Promise.resolve()
      expect(latePreparationSideEffect).toBe(false)
      expect(sfx.start).not.toHaveBeenCalled()
      expect(sfx.terminate).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('bounds SFX start and prevents an aborted late playback side effect', async () => {
    jest.useFakeTimers()
    try {
      const sfx = mockSfxPlayer()
      const playback = deferred<void>()
      let latePlaybackSideEffect = false
      sfx.start.mockImplementationOnce(async (_cue, signal) => {
        await playback.promise
        if (!signal.aborted) latePlaybackSideEffect = true
      })
      const host = createHost({ sfx })
      const resultPromise = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(1_000)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'started',
          sfxStatus: 'start-failed-cleaned',
          partialReasons: expect.arrayContaining(['sfx-start-failed']),
        })
      )
      playback.resolve()
      await Promise.resolve()
      expect(latePlaybackSideEffect).toBe(false)
      expect(sfx.terminate).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('quarantines a non-cooperative SFX prepare until one terminal join completes', async () => {
    jest.useFakeTimers()
    try {
      const sfx = mockSfxPlayer()
      const preparation = deferred<void>()
      let generation = 0
      let resourceActive = false
      let cleanupCount = 0
      sfx.prepare.mockImplementationOnce(async () => {
        const ownedGeneration = generation
        await preparation.promise
        if (ownedGeneration === generation) resourceActive = true
      })
      sfx.terminate.mockImplementationOnce(async () => {
        generation += 1
        await preparation.promise
        resourceActive = false
        cleanupCount += 1
      })
      const host = createHost({ sfx })
      const resultPromise = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(2_250)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'blocked-terminal-cleanup',
          activeEffectId: FIRE_EFFECT_ID,
        })
      )
      const replacement = host.dispatch(
        startCommand({ commandId: 'fire.start.prepareQuarantined' })
      )
      await jest.advanceTimersByTimeAsync(1_000)
      await expect(replacement).resolves.toEqual(
        expect.objectContaining({ status: 'blocked-terminal-cleanup' })
      )
      preparation.resolve()
      await Promise.resolve()
      expect(resourceActive).toBe(false)
      expect(cleanupCount).toBe(1)
      expect(sfx.terminate).toHaveBeenCalledTimes(1)
      await expect(
        host.dispatch(startCommand({ commandId: 'fire.start.prepareJoined' }))
      ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('quarantines a non-cooperative SFX start without late playback', async () => {
    jest.useFakeTimers()
    try {
      const sfx = mockSfxPlayer()
      const playback = deferred<void>()
      let generation = 0
      let playbackActive = false
      let cleanupCount = 0
      sfx.start.mockImplementationOnce(async () => {
        const ownedGeneration = generation
        await playback.promise
        if (ownedGeneration === generation) playbackActive = true
      })
      sfx.terminate.mockImplementationOnce(async () => {
        generation += 1
        await playback.promise
        playbackActive = false
        cleanupCount += 1
      })
      const host = createHost({ sfx })
      const resultPromise = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(2_250)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'blocked-terminal-cleanup',
          activeEffectId: FIRE_EFFECT_ID,
        })
      )
      playback.resolve()
      await Promise.resolve()
      expect(playbackActive).toBe(false)
      expect(cleanupCount).toBe(1)
      expect(sfx.terminate).toHaveBeenCalledTimes(1)
      await expect(
        host.dispatch(startCommand({ commandId: 'fire.start.playbackJoined' }))
      ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('rejects an invalid replacement without stopping the active effect', async () => {
    const host = createHost()
    await host.dispatch(startCommand())
    await expect(
      host.dispatch(
        startCommand({
          commandId: 'fire.replace.invalid',
          parameters: { noiseStrength: 99 },
        })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'rejected',
        activeEffectId: FIRE_EFFECT_ID,
        replacedEffectId: null,
      })
    )
    await expect(
      host.dispatch(
        startCommand({
          commandId: 'fire.replace.unknown',
          parameters: { unknownControl: 1 },
        })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'rejected',
        activeEffectId: FIRE_EFFECT_ID,
      })
    )
  })

  it('bounds fresh-session disposal when canonical parameters are invalid', async () => {
    jest.useFakeTimers()
    try {
      const disposal = deferred<void>()
      const registry = new ProjectionEffectRegistry()
      let rendererCreateCount = 0
      const firstDispose = jest.fn(() => disposal.promise)
      registry.register({
        definition: fireEffectDefinition,
        createRenderer: () => {
          rendererCreateCount += 1
          return rendererCreateCount === 1
            ? {
                render: jest.fn(),
                reset: jest.fn(),
                dispose: firstDispose,
              }
            : new FireParticleRenderer({ waitFrame: async () => {} })
        },
      })
      const host = new ProjectionEffectHost({
        registry,
        capabilities: READY_CAPABILITIES,
        nowMs: incrementingClock(),
      })
      const resultPromise = host.dispatch(
        startCommand({
          commandId: 'fire.start.invalidFresh',
          parameters: { noiseStrength: 99 },
        })
      )
      await jest.advanceTimersByTimeAsync(750)
      await expect(resultPromise).resolves.toEqual(
        expect.objectContaining({
          status: 'blocked-terminal-cleanup',
          activeEffectId: null,
          visualStatus: 'dispose-failed',
          partialReasons: expect.arrayContaining(['visual-dispose-failed']),
        })
      )
      const replacement = host.dispatch(
        startCommand({ commandId: 'fire.start.freshQuarantined' })
      )
      await jest.advanceTimersByTimeAsync(750)
      await expect(replacement).resolves.toEqual(
        expect.objectContaining({ status: 'blocked-terminal-cleanup' })
      )
      expect(firstDispose).toHaveBeenCalledTimes(1)
      disposal.resolve()
      await expect(
        host.dispatch(startCommand({ commandId: 'fire.start.freshJoined' }))
      ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts prepared SFX and disposes a fresh session when start is blocked', async () => {
    const blockedDefinition = cloneDefinition(fireEffectDefinition)
    blockedDefinition.sourceMappings[0].status = 'unknown'
    const renderer: ProjectionEffectRenderer = {
      render: jest.fn(),
      reset: jest.fn(),
      dispose: jest.fn(),
    }
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: blockedDefinition,
      createRenderer: () => renderer,
    })
    const sfx = mockSfxPlayer()
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      sfxPlayer: sfx,
      sfxCues: [fireEffectSfxCue],
      nowMs: incrementingClock(),
    })

    await expect(host.dispatch(startCommand())).resolves.toEqual(
      expect.objectContaining({
        status: 'visual-failed',
        activeEffectId: null,
        visualStatus: 'blocked-mapping',
      })
    )
    const prepareSignal = sfx.prepare.mock.calls[0]?.[1]
    expect(prepareSignal?.aborted).toBe(true)
    expect(sfx.start).not.toHaveBeenCalled()
    expect(sfx.terminate).toHaveBeenCalledTimes(1)
    expect(renderer.dispose).toHaveBeenCalledTimes(1)
  })

  it('retains a prepared SFX owner when visual start fails before activation', async () => {
    jest.useFakeTimers()
    try {
      const registry = new ProjectionEffectRegistry()
      registry.register(createFireParticlePlugin({ waitFrame: async () => {} }))
      const realCreateSession = registry.createSession.bind(registry)
      const blockedSession: ProjectionEffectSession = {
        definition: fireEffectDefinition,
        lifecycle: 'suspended',
        start: async () => ({
          status: 'blocked-mapping',
          lifecycle: 'suspended',
          parameterErrorCount: 0,
        }),
        update: async () => ({
          status: 'skipped-not-running',
          lifecycle: 'suspended',
          parameterErrorCount: 0,
        }),
        stop: async () => ({
          status: 'stopped',
          lifecycle: 'ready',
          parameterErrorCount: 0,
        }),
        reset: async () => ({
          status: 'reset',
          lifecycle: 'ready',
          parameterErrorCount: 0,
        }),
        dispose: async () => ({
          status: 'disposed',
          lifecycle: 'disposed',
          parameterErrorCount: 0,
        }),
        terminate: async () => ({
          status: 'disposed',
          lifecycle: 'disposed',
          parameterErrorCount: 0,
        }),
      }
      jest
        .spyOn(registry, 'createSession')
        .mockImplementationOnce(() => blockedSession)
        .mockImplementation((effectId) => realCreateSession(effectId))
      const sfx = mockSfxPlayer()
      const terminal = deferred<void>()
      sfx.terminate.mockImplementationOnce(() => terminal.promise)
      const host = new ProjectionEffectHost({
        registry,
        capabilities: READY_CAPABILITIES,
        sfxPlayer: sfx,
        sfxCues: [fireEffectSfxCue],
        nowMs: incrementingClock(),
      })
      const failedStart = host.dispatch(startCommand())
      await jest.advanceTimersByTimeAsync(250)
      await expect(failedStart).resolves.toEqual(
        expect.objectContaining({
          status: 'blocked-terminal-cleanup',
          activeEffectId: null,
        })
      )
      const replacement = host.dispatch(
        startCommand({ commandId: 'fire.start.preActiveQuarantined' })
      )
      await jest.advanceTimersByTimeAsync(1_000)
      await expect(replacement).resolves.toEqual(
        expect.objectContaining({ status: 'blocked-terminal-cleanup' })
      )
      expect(sfx.terminate).toHaveBeenCalledTimes(1)
      terminal.resolve()
      await expect(
        host.dispatch(startCommand({ commandId: 'fire.start.preActiveJoined' }))
      ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
    } finally {
      jest.useRealTimers()
    }
  })

  it('strictly snapshots SFX cues without caller-owned fields', () => {
    const registry = new ProjectionEffectRegistry()
    registry.register(createFireParticlePlugin({ waitFrame: async () => {} }))
    expect(
      () =>
        new ProjectionEffectHost({
          registry,
          capabilities: READY_CAPABILITIES,
          sfxPlayer: mockSfxPlayer(),
          sfxCues: [
            {
              ...fireEffectSfxCue,
              path: 'private/local/fire.wav',
            } as typeof fireEffectSfxCue,
          ],
        })
    ).toThrow('invalid projection effect SFX cue')
    const inheritedCue = Object.create(fireEffectSfxCue)
    expect(
      () =>
        new ProjectionEffectHost({
          registry,
          capabilities: READY_CAPABILITIES,
          sfxPlayer: mockSfxPlayer(),
          sfxCues: [inheritedCue as typeof fireEffectSfxCue],
        })
    ).toThrow('invalid projection effect SFX cue')
  })

  it('requires all five own SFX fields and never echoes polluted/private keys', () => {
    const missingEffectId = {
      cueId: fireEffectSfxCue.cueId,
      noisy: true,
      loop: false,
      defaultGain: 0.5,
    }
    const objectPrototype = Object.prototype as unknown as Record<
      string,
      unknown
    >
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'effectId'
    )
    try {
      Object.defineProperty(Object.prototype, 'effectId', {
        configurable: true,
        enumerable: true,
        value: FIRE_EFFECT_ID,
      })
      expect(validateProjectionEffectSfxCue(missingEffectId)).toEqual(
        expect.arrayContaining(['sfx.fields.invalid', 'sfx.effect_id.invalid'])
      )
    } finally {
      if (!originalDescriptor) {
        delete objectPrototype.effectId
      } else {
        Object.defineProperty(Object.prototype, 'effectId', originalDescriptor)
      }
    }

    const privateCue = {
      ...fireEffectSfxCue,
      ...Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `privatePath${index}${'x'.repeat(80)}`,
          'must-not-escape',
        ])
      ),
    }
    const errors = validateProjectionEffectSfxCue(privateCue)
    expect(errors).toContain('sfx.fields.invalid')
    expect(errors.length).toBeLessThanOrEqual(6)
    expect(JSON.stringify(errors)).not.toContain('private')
    expect(JSON.stringify(errors)).not.toContain('must-not-escape')
  })

  it('retains an owned null-prototype SFX cue after caller mutation', async () => {
    const registry = new ProjectionEffectRegistry()
    registry.register(createFireParticlePlugin({ waitFrame: async () => {} }))
    const sfx = mockSfxPlayer()
    const cue = {
      effectId: fireEffectSfxCue.effectId,
      cueId: fireEffectSfxCue.cueId as string,
      noisy: true as const,
      loop: fireEffectSfxCue.loop,
      defaultGain: fireEffectSfxCue.defaultGain,
    }
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      sfxPlayer: sfx,
      sfxCues: [cue],
      nowMs: incrementingClock(),
    })
    cue.cueId = 'mutated.after.constructor'
    await host.dispatch(startCommand())
    const preparedCue = sfx.prepare.mock.calls[0][0]
    if (!preparedCue) throw new Error('SFX prepare cue was not captured')
    expect(preparedCue.cueId).toBe(fireEffectSfxCue.cueId)
    expect(Object.getPrototypeOf(preparedCue)).toBeNull()
    expect(Object.isFrozen(preparedCue)).toBe(true)
  })

  it('bounds central effect cost controls instead of allowing plugin-local chaos', () => {
    expect(
      normalizeProjectionEffectQualityPolicy({
        particleBudget: Number.POSITIVE_INFINITY,
        internalResolutionScale: 0.01,
        updateRateHz: 240,
        postProcessing: false,
      })
    ).toEqual({
      particleBudget: 1800,
      internalResolutionScale: 0.25,
      updateRateHz: 60,
      postProcessing: false,
    })
  })

  it('applies the central update-rate limit to renderer-owned frame progression', async () => {
    let nowMs = 1000
    const host = createHost({
      nowMs: () => {
        nowMs += 4
        return nowMs
      },
    })
    await host.dispatch(startCommand())
    await expect(host.renderFrame()).resolves.toEqual(
      expect.objectContaining({ status: 'frame-skipped' })
    )
  })

  it('refreshes active quality-owned parameters on the next frame', async () => {
    const render = jest.fn()
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fireEffectDefinition,
      createRenderer: () => ({
        render,
        reset: jest.fn(),
        dispose: jest.fn(),
      }),
    })
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      nowMs: incrementingClock(),
    })
    await host.dispatch(startCommand())
    host.updateQualityPolicy({
      particleBudget: 64,
      internalResolutionScale: 0.5,
      postProcessing: false,
    })
    await host.renderFrame()
    expect(render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({
          particleBudget: 64,
          internalResolutionScale: 0.5,
          postProcessing: false,
        }),
      })
    )
  })

  it('propagates fixed stop/dispose failure classes and rejects late updates', async () => {
    const renderer: ProjectionEffectRenderer = {
      render: jest.fn(),
      stop: jest.fn(async () => {
        throw new Error('private stop failure')
      }),
      reset: jest.fn(),
      dispose: jest.fn(async () => {
        throw new Error('private dispose failure')
      }),
    }
    const registry = new ProjectionEffectRegistry()
    registry.register({
      definition: fireEffectDefinition,
      createRenderer: () => renderer,
    })
    const host = new ProjectionEffectHost({
      registry,
      capabilities: READY_CAPABILITIES,
      nowMs: incrementingClock(),
    })
    await host.dispatch(startCommand())
    const stopped = await host.dispatch(stopCommand('normal'))
    expect(stopped).toEqual(
      expect.objectContaining({
        status: 'stop-failed',
        activeEffectId: FIRE_EFFECT_ID,
        visualStatus: 'dispose-failed',
        partialReasons: expect.arrayContaining([
          'visual-stop-failed',
          'visual-dispose-failed',
        ]),
      })
    )
    expect(JSON.stringify(stopped)).not.toContain('private')
    await expect(
      host.dispatch(updateCommand({ noiseStrength: 0.8 }))
    ).resolves.toEqual(
      expect.objectContaining({ status: 'blocked-terminal-cleanup' })
    )
    expect(renderer.render).toHaveBeenCalledTimes(1)
  })

  it('quarantines a hung visual cleanup and blocks replacement until terminal disposal', async () => {
    jest.useFakeTimers()
    try {
      const stopWait = deferred<void>()
      const disposal = deferred<void>()
      const renderer: ProjectionEffectRenderer = {
        render: jest.fn(),
        stop: jest.fn(() => stopWait.promise),
        reset: jest.fn(),
        dispose: jest.fn(() => disposal.promise),
      }
      const registry = new ProjectionEffectRegistry()
      let rendererCreateCount = 0
      registry.register({
        definition: fireEffectDefinition,
        createRenderer: () => {
          rendererCreateCount += 1
          return rendererCreateCount === 1
            ? renderer
            : new FireParticleRenderer({ waitFrame: async () => {} })
        },
      })
      const host = new ProjectionEffectHost({
        registry,
        capabilities: READY_CAPABILITIES,
        nowMs: incrementingClock(),
      })
      await host.dispatch(startCommand())
      const stopResult = host.dispatch(stopCommand('normal'))
      await jest.advanceTimersByTimeAsync(3_000)
      await expect(stopResult).resolves.toEqual(
        expect.objectContaining({
          status: 'stop-failed',
          activeEffectId: FIRE_EFFECT_ID,
          partialReasons: expect.arrayContaining([
            'visual-stop-failed',
            'visual-dispose-failed',
          ]),
        })
      )

      const replacement = host.dispatch(
        startCommand({ commandId: 'fire.start.quarantined' })
      )
      await jest.advanceTimersByTimeAsync(750)
      await expect(replacement).resolves.toEqual(
        expect.objectContaining({ status: 'blocked-terminal-cleanup' })
      )
      disposal.resolve()
      const disposalOnlyReplacement = host.dispatch(
        startCommand({ commandId: 'fire.start.disposeOnly' })
      )
      await jest.advanceTimersByTimeAsync(750)
      await expect(disposalOnlyReplacement).resolves.toEqual(
        expect.objectContaining({ status: 'blocked-terminal-cleanup' })
      )
      expect(renderer.dispose).not.toHaveBeenCalled()
      stopWait.resolve()
      await Promise.resolve()
      const retrigger = host.dispatch(
        startCommand({ commandId: 'fire.start.afterTerminal' })
      )
      await jest.advanceTimersByTimeAsync(1)
      await expect(retrigger).resolves.toEqual(
        expect.objectContaining({ status: 'started' })
      )
    } finally {
      jest.useRealTimers()
    }
  })

  it('aborts a timed-out visual stop so late completion cannot draw', async () => {
    jest.useFakeTimers()
    try {
      const stopWait = deferred<void>()
      const lateDraw = jest.fn()
      const renderer: ProjectionEffectRenderer = {
        render: jest.fn(),
        stop: jest.fn(async (context) => {
          await stopWait.promise
          if (!context.signal?.aborted) lateDraw()
        }),
        reset: jest.fn(),
        dispose: jest.fn(),
      }
      const registry = new ProjectionEffectRegistry()
      let rendererCreateCount = 0
      registry.register({
        definition: fireEffectDefinition,
        createRenderer: () => {
          rendererCreateCount += 1
          return rendererCreateCount === 1
            ? renderer
            : new FireParticleRenderer({ waitFrame: async () => {} })
        },
      })
      const host = new ProjectionEffectHost({
        registry,
        capabilities: READY_CAPABILITIES,
        nowMs: incrementingClock(),
      })
      await host.dispatch(startCommand())
      const stopResult = host.dispatch(stopCommand('normal'))
      await jest.advanceTimersByTimeAsync(3_000)
      await expect(stopResult).resolves.toEqual(
        expect.objectContaining({
          status: 'stop-failed',
          activeEffectId: FIRE_EFFECT_ID,
          partialReasons: expect.arrayContaining([
            'visual-stop-failed',
            'visual-dispose-failed',
          ]),
        })
      )
      stopWait.resolve()
      await Promise.resolve()
      expect(lateDraw).not.toHaveBeenCalled()
      await expect(
        host.dispatch(
          startCommand({ commandId: 'fire.start.afterAbortedStop' })
        )
      ).resolves.toEqual(expect.objectContaining({ status: 'started' }))
      expect(renderer.dispose).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('never returns rejected private command fields', async () => {
    const host = createHost()
    const result = await host.dispatch({
      ...startCommand(),
      privateRawText: 'must-not-escape',
    })
    expect(result).toEqual(expect.objectContaining({ status: 'rejected' }))
    expect(JSON.stringify(result)).not.toContain('must-not-escape')
    expect(JSON.stringify(result)).not.toContain('privateRawText')
  })
})

function createHost(
  overrides: {
    capabilities?: ProjectionEffectRuntimeCapabilities
    sfx?: ReturnType<typeof mockSfxPlayer>
    renderer?: FireParticleRenderer
    nowMs?: () => number
  } = {}
): ProjectionEffectHost {
  const registry = new ProjectionEffectRegistry()
  let firstRenderer = overrides.renderer
  registry.register({
    definition: fireEffectDefinition,
    createRenderer: () => {
      const renderer =
        firstRenderer ?? new FireParticleRenderer({ waitFrame: async () => {} })
      firstRenderer = undefined
      return renderer
    },
  })
  return new ProjectionEffectHost({
    registry,
    capabilities: overrides.capabilities ?? READY_CAPABILITIES,
    sfxPlayer: overrides.sfx ?? mockSfxPlayer(),
    sfxCues: [fireEffectSfxCue],
    nowMs: overrides.nowMs ?? incrementingClock(),
  })
}

function mockSfxPlayer() {
  return {
    prepare: jest.fn(
      async (_cue: ProjectionEffectSfxCue, _signal: AbortSignal) => {}
    ),
    start: jest.fn(
      async (_cue: ProjectionEffectSfxCue, _signal: AbortSignal) => {}
    ),
    fadeOut: jest.fn(
      async (_cue: ProjectionEffectSfxCue, _fadeMs: number) => {}
    ),
    terminate: jest.fn(async (_cue: ProjectionEffectSfxCue) => {}),
  } satisfies ProjectionEffectSfxPlayer
}

function startCommand(
  overrides: Partial<{
    commandId: string
    effectId: string
    parameters: Readonly<Record<string, unknown>>
    speechCompletion: 'finished' | 'timeout'
  }> = {}
) {
  return {
    schemaVersion: 1,
    commandId: 'fire.start.one',
    effectId: FIRE_EFFECT_ID,
    action: 'start',
    parameters: { noiseStrength: 0.5 },
    speechCompletion: 'finished',
    ...overrides,
  } as const
}

function updateCommand(parameters: Readonly<Record<string, unknown>>) {
  return {
    schemaVersion: 1,
    commandId: 'fire.update.one',
    effectId: FIRE_EFFECT_ID,
    action: 'update',
    parameters,
  } as const
}

function stopCommand(mode: 'normal' | 'emergency') {
  return {
    schemaVersion: 1,
    commandId: `fire.stop.${mode}`,
    effectId: FIRE_EFFECT_ID,
    action: 'stop',
    mode,
  } as const
}

function resetCommand() {
  return {
    schemaVersion: 1,
    commandId: 'fire.reset.one',
    effectId: FIRE_EFFECT_ID,
    action: 'reset',
  } as const
}

function defaultFireParameters(
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  return {
    ...Object.fromEntries(
      fireEffectDefinition.parameters.map((parameter) => [
        parameter.id,
        parameter.defaultValue,
      ])
    ),
    ...overrides,
  }
}

function incrementingClock(): () => number {
  let nowMs = 1000
  return () => {
    nowMs += 17
    return nowMs
  }
}

function cloneDefinition(
  definition: ProjectionEffectDefinition
): ProjectionEffectDefinition {
  return JSON.parse(JSON.stringify(definition)) as ProjectionEffectDefinition
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
