import {
  THUNDER_WEBGL2_MAX_DRAIN_MS,
  THUNDER_WEBGL2_PASS_GRAPH,
  type ThunderWebGl2EngineAudit,
  type ThunderWebGl2EngineFrame,
  type ThunderWebGl2EngineResult,
} from '../plugins/thunderBall/webgl2/contracts'
import {
  ThunderBallWebGl2Renderer,
  type ThunderWebGl2EngineBoundary,
} from '../plugins/thunderBall/webgl2/renderer'
import { createThunderWebGl2Topology } from '../plugins/thunderBall/webgl2/topology'

describe('Thunder Ball WebGL2 renderer lifecycle', () => {
  it('starts, renders, disables births on stop, and drains within five seconds', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine, seed: 91 })

    expect(renderer.start({ nowMs: 0 })).toMatchObject({
      status: 'started',
      state: 'running',
    })
    expect(renderer.renderFrame({ nowMs: 0 })).toMatchObject({
      status: 'rendered',
    })
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: true,
      connectionCount: 21,
      topologyEpoch: 0,
    })

    expect(renderer.stop({ nowMs: 10, fadeMs: 99_999 })).toMatchObject({
      status: 'draining',
      state: 'draining',
    })
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      drainDeadlineMs: 10 + THUNDER_WEBGL2_MAX_DRAIN_MS,
    })
    expect(renderer.renderFrame({ nowMs: 100 })).toMatchObject({
      status: 'draining',
    })
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      topologyEpoch: 0,
    })
    expect(
      renderer.renderFrame({ nowMs: 10 + THUNDER_WEBGL2_MAX_DRAIN_MS })
    ).toMatchObject({ status: 'stopped', state: 'stopped' })
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      connectionCount: 0,
      drainDeadlineMs: null,
    })
  })

  it('reset and emergency stop clear topology and temporal targets immediately', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine })
    renderer.start()
    renderer.renderFrame({ nowMs: 0 })

    expect(renderer.reset()).toMatchObject({ status: 'reset', state: 'idle' })
    expect(engine.reset).toHaveBeenCalledTimes(1)
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      connectionCount: 0,
      topologyEpoch: null,
    })

    renderer.start({ nowMs: 100 })
    renderer.renderFrame({ nowMs: 100 })
    expect(renderer.emergencyStop()).toMatchObject({
      status: 'emergency-stopped',
      state: 'stopped',
    })
    expect(engine.reset).toHaveBeenCalledTimes(2)
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      connectionCount: 0,
      drainDeadlineMs: null,
    })
  })

  it('keeps source temporal smoothing disabled while reducing glow cadence', () => {
    const normalEngine = new FakeEngine()
    const normal = new ThunderBallWebGl2Renderer({
      engine: normalEngine,
      seed: 8,
    })
    normal.start({ nowMs: 40 })
    normal.renderFrame({ nowMs: 40 })
    const normalFrame = normalEngine.render.mock.calls[0]?.[0]

    const reducedEngine = new FakeEngine()
    const reduced = new ThunderBallWebGl2Renderer({
      engine: reducedEngine,
      seed: 8,
      reducedMotion: true,
    })
    reduced.start({ nowMs: 40 })
    reduced.renderFrame({ nowMs: 40 })
    const reducedFrame = reducedEngine.render.mock.calls[0]?.[0]

    expect(normalFrame?.tone.feedback).toBe(0)
    expect(reducedFrame?.tone.feedback).toBe(0)
    expect(normalFrame?.tone.pulse).toBe(0)
    expect(reducedFrame?.tone.pulse).toBe(0)
    expect(reducedFrame?.tone.glowLevel ?? 0).toBeLessThan(
      normalFrame?.tone.glowLevel ?? 0
    )
    expect(reduced.topologySnapshot()?.cadenceMs).toBeGreaterThan(
      normal.topologySnapshot()?.cadenceMs ?? Number.POSITIVE_INFINITY
    )
  })

  it('uses the explicit CSS projection aspect independently of backing size', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine, seed: 502 })
    renderer.start({ nowMs: 240 })
    renderer.renderFrame({
      nowMs: 240,
      width: 720,
      height: 405,
      projectionAspect: 4 / 3,
    })

    expect(renderer.topologySnapshot()).toEqual(
      createThunderWebGl2Topology({
        seed: 502,
        nowMs: 240,
        aspect: 4 / 3,
      })
    )
  })

  it('pauses without topology or GPU work and resumes from frozen simulation time', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine, seed: 73 })
    renderer.start({ nowMs: 0 })
    renderer.renderFrame({ nowMs: 0 })

    const frozenTopology = renderer.topologySnapshot()
    const renderCalls = engine.render.mock.calls.length
    const resizeCalls = engine.resize.mock.calls.length
    expect(renderer.pause({ nowMs: 0 })).toEqual({
      status: 'paused',
      state: 'paused',
      failure: null,
    })
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      pausedAtMs: 0,
      topologyEpoch: 0,
    })

    expect(
      renderer.renderFrame({
        nowMs: 5_000,
        width: 1_280,
        height: 720,
        reducedMotion: true,
      })
    ).toMatchObject({ status: 'paused', state: 'paused' })
    expect(engine.render).toHaveBeenCalledTimes(renderCalls)
    expect(engine.resize).toHaveBeenCalledTimes(resizeCalls)
    expect(renderer.topologySnapshot()).toBe(frozenTopology)

    expect(renderer.resume({ nowMs: 5_000 })).toEqual({
      status: 'resumed',
      state: 'running',
      failure: null,
    })
    expect(renderer.renderFrame({ nowMs: 5_000 })).toMatchObject({
      status: 'rendered',
      state: 'running',
    })
    expect(engine.render).toHaveBeenCalledTimes(renderCalls + 1)
    expect(renderer.topologySnapshot()).toBe(frozenTopology)
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: true,
      pausedAtMs: null,
      topologyEpoch: 0,
    })
  })

  it('can stop from paused state and still clears within the drain bound', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine })
    renderer.start({ nowMs: 0 })
    renderer.renderFrame({ nowMs: 0 })
    renderer.pause({ nowMs: 1 })

    expect(
      renderer.stop({
        nowMs: 1 + THUNDER_WEBGL2_MAX_DRAIN_MS,
        fadeMs: THUNDER_WEBGL2_MAX_DRAIN_MS,
      })
    ).toMatchObject({ status: 'draining', state: 'draining' })
    expect(
      renderer.renderFrame({
        nowMs: 1 + THUNDER_WEBGL2_MAX_DRAIN_MS * 2,
      })
    ).toMatchObject({ status: 'stopped', state: 'stopped' })
    expect(engine.clear).toHaveBeenCalledTimes(1)
    expect(renderer.snapshot()).toMatchObject({
      birthsEnabled: false,
      connectionCount: 0,
      pausedAtMs: null,
    })
  })

  it('quarantines a fixed engine failure without exposing private native text', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine })
    renderer.start()
    engine.failNextRender()

    const failed = renderer.renderFrame({ nowMs: 0 })
    expect(failed).toEqual({
      status: 'blocked',
      state: 'quarantined',
      failure: 'draw-failed',
    })
    expect(JSON.stringify(failed)).not.toContain(
      'private://driver/C:/secret/thunder.bin'
    )
    const calls = engine.render.mock.calls.length
    expect(renderer.renderFrame({ nowMs: 10 })).toMatchObject({
      status: 'blocked',
    })
    expect(engine.render).toHaveBeenCalledTimes(calls)
  })

  it('disposes idempotently and permits no later GPU work', () => {
    const engine = new FakeEngine()
    const renderer = new ThunderBallWebGl2Renderer({ engine })
    renderer.start()
    renderer.renderFrame({ nowMs: 0 })

    expect(renderer.dispose()).toMatchObject({
      status: 'disposed',
      state: 'disposed',
    })
    expect(renderer.dispose()).toMatchObject({
      status: 'disposed',
      state: 'disposed',
    })
    expect(engine.dispose).toHaveBeenCalledTimes(1)
    const renderCalls = engine.render.mock.calls.length
    expect(renderer.start()).toMatchObject({ status: 'disposed' })
    expect(renderer.renderFrame({ nowMs: 1 })).toMatchObject({
      status: 'disposed',
      state: 'disposed',
    })
    expect(engine.render).toHaveBeenCalledTimes(renderCalls)
  })
})

class FakeEngine implements ThunderWebGl2EngineBoundary {
  private state: ThunderWebGl2EngineAudit['state'] = 'ready'
  private failure: ThunderWebGl2EngineAudit['failure'] = null
  private width = 640
  private height = 360
  private renderFailurePending = false

  render = jest.fn(
    (_frame: Readonly<ThunderWebGl2EngineFrame>): ThunderWebGl2EngineResult => {
      if (this.renderFailurePending) {
        this.renderFailurePending = false
        this.state = 'quarantined'
        this.failure = 'draw-failed'
        return fixedResult('blocked', this.state, this.failure)
      }
      return fixedResult('rendered', this.state, this.failure)
    }
  )

  resize = jest.fn(
    (width: number, height: number): ThunderWebGl2EngineResult => {
      this.width = width
      this.height = height
      return fixedResult('resized', this.state, this.failure)
    }
  )

  reset = jest.fn(
    (): ThunderWebGl2EngineResult =>
      fixedResult('cleared', this.state, this.failure)
  )

  clear = jest.fn(
    (): ThunderWebGl2EngineResult =>
      fixedResult('cleared', this.state, this.failure)
  )

  dispose = jest.fn((): ThunderWebGl2EngineResult => {
    this.state = 'disposed'
    this.failure = null
    return fixedResult('disposed', this.state, this.failure)
  })

  audit(): Readonly<ThunderWebGl2EngineAudit> {
    return Object.freeze({
      state: this.state,
      failure: this.failure,
      width: this.width,
      height: this.height,
      drawCount: this.render.mock.calls.length,
      resizeCount: this.resize.mock.calls.length,
      feedbackIndex: 0,
      passGraph: THUNDER_WEBGL2_PASS_GRAPH,
      resources: Object.freeze({
        shader: 0,
        program: 0,
        buffer: 0,
        vertexArray: 0,
        texture: 0,
        framebuffer: 0,
        total: 0,
      }),
      cleanupAttemptedKinds: Object.freeze([]),
    })
  }

  failNextRender(): void {
    this.renderFailurePending = true
  }
}

function fixedResult(
  status: ThunderWebGl2EngineResult['status'],
  state: ThunderWebGl2EngineResult['state'],
  failure: ThunderWebGl2EngineResult['failure']
): ThunderWebGl2EngineResult {
  return Object.freeze({ status, state, failure })
}
