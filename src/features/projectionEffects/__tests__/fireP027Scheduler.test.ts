import { FIRE_P027_FIXED_DT_SECONDS } from '../plugins/fire/p027/contracts'
import { FireP027Scheduler } from '../plugins/fire/p027/scheduler'

describe('P027 Fire fixed scheduler', () => {
  it('emits exactly five slots per 60 Hz update at Birth 300', () => {
    const scheduler = new FireP027Scheduler()
    expect(scheduler.nextBatch(300, 1)).toEqual({
      start: 0,
      count: 5,
      generationBase: 0,
      logicalUpdate: 0,
      dtSeconds: FIRE_P027_FIXED_DT_SECONDS,
    })
  })

  it('discards a fractional birth remainder whenever the raw gate is off', () => {
    const scheduler = new FireP027Scheduler()
    expect(scheduler.nextBatch(30, 1).count).toBe(0)
    expect(scheduler.snapshot().birthAccumulator).toBeCloseTo(0.5)
    expect(scheduler.nextBatch(30, 0).count).toBe(0)
    expect(scheduler.snapshot().birthAccumulator).toBe(0)
    expect(scheduler.nextBatch(30, 1).count).toBe(0)
  })

  it('stops births while continuing finite state updates', () => {
    const scheduler = new FireP027Scheduler()
    scheduler.stop()
    const batch = scheduler.nextBatch(300, 1)
    expect(batch.count).toBe(0)
    expect(batch.logicalUpdate).toBe(0)
    expect(scheduler.snapshot()).toEqual(
      expect.objectContaining({ state: 'stopped', logicalUpdate: 1 })
    )
  })

  it('freezes wall time only when paused', () => {
    const scheduler = new FireP027Scheduler()
    scheduler.pause()
    expect(scheduler.consumeWallTime(0.25)).toBe(0)
    expect(scheduler.snapshot().wallAccumulator).toBe(0)
    scheduler.start()
    expect(scheduler.consumeWallTime(0.25)).toBe(8)
  })

  it('wraps the 150-slot ring without losing monotonic generation', () => {
    const scheduler = new FireP027Scheduler()
    for (let update = 0; update < 30; update += 1) {
      scheduler.nextBatch(300, 1)
    }
    expect(scheduler.snapshot()).toEqual(
      expect.objectContaining({ cursor: 0, generation: 150, logicalUpdate: 30 })
    )
    expect(scheduler.nextBatch(300, 1)).toEqual(
      expect.objectContaining({ start: 0, generationBase: 150, count: 5 })
    )
  })

  it('atomically restores transport and every scheduler counter on reset', () => {
    const scheduler = new FireP027Scheduler()
    scheduler.consumeWallTime(0.1)
    scheduler.nextBatch(300, 1)
    scheduler.stop()
    scheduler.reset()
    expect(scheduler.snapshot()).toEqual({
      birthAccumulator: 0,
      cursor: 0,
      generation: 0,
      logicalUpdate: 0,
      state: 'running',
      wallAccumulator: 0,
    })
  })
})
