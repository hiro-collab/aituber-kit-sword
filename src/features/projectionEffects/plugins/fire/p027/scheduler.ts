import {
  FIRE_P027_FIXED_DT_SECONDS,
  FIRE_P027_SLOT_COUNT,
  type FireP027SpawnBatch,
} from './contracts'

export type FireP027TransportState = 'running' | 'stopped' | 'paused'

export interface FireP027SchedulerSnapshot {
  birthAccumulator: number
  cursor: number
  generation: number
  logicalUpdate: number
  state: FireP027TransportState
  wallAccumulator: number
}

/** CPU event scheduler only; particle state remains owned by the GPU surface. */
export class FireP027Scheduler {
  private stateValue: FireP027TransportState = 'running'
  private birthAccumulatorValue = 0
  private cursorValue = 0
  private generationValue = 0
  private logicalUpdateValue = 0
  private wallAccumulatorValue = 0

  start(): void {
    this.stateValue = 'running'
  }

  stop(): void {
    this.stateValue = 'stopped'
    this.birthAccumulatorValue = 0
  }

  pause(): void {
    this.stateValue = 'paused'
  }

  reset(): void {
    this.stateValue = 'running'
    this.birthAccumulatorValue = 0
    this.cursorValue = 0
    this.generationValue = 0
    this.logicalUpdateValue = 0
    this.wallAccumulatorValue = 0
  }

  /** Stop keeps integrating live particles; Pause freezes state and time. */
  consumeWallTime(seconds: number, maxSteps = 8): number {
    if (this.stateValue === 'paused') return 0
    this.wallAccumulatorValue += Math.min(Math.max(seconds, 0), 0.25)
    const boundedSteps = Math.max(0, Math.floor(maxSteps))
    const steps = Math.min(
      boundedSteps,
      Math.floor(this.wallAccumulatorValue / FIRE_P027_FIXED_DT_SECONDS)
    )
    this.wallAccumulatorValue -= steps * FIRE_P027_FIXED_DT_SECONDS
    return steps
  }

  nextBatch(birthPerSecond: number, rawGate: number): FireP027SpawnBatch {
    const gate = this.stateValue === 'running' ? clamp(rawGate, 0, 1) : 0
    if (gate <= 0) {
      // OFF discards a fractional remainder so a later ON starts cleanly.
      this.birthAccumulatorValue = 0
    } else {
      this.birthAccumulatorValue +=
        Math.max(0, finiteOrZero(birthPerSecond)) * FIRE_P027_FIXED_DT_SECONDS
    }

    const count = Math.min(
      FIRE_P027_SLOT_COUNT,
      Math.floor(this.birthAccumulatorValue)
    )
    this.birthAccumulatorValue -= count
    const batch: FireP027SpawnBatch = {
      start: this.cursorValue,
      count,
      generationBase: this.generationValue,
      logicalUpdate: this.logicalUpdateValue,
      dtSeconds: FIRE_P027_FIXED_DT_SECONDS,
    }
    this.cursorValue = (this.cursorValue + count) % FIRE_P027_SLOT_COUNT
    this.generationValue += count
    this.logicalUpdateValue += 1
    return batch
  }

  snapshot(): Readonly<FireP027SchedulerSnapshot> {
    return Object.freeze({
      birthAccumulator: this.birthAccumulatorValue,
      cursor: this.cursorValue,
      generation: this.generationValue,
      logicalUpdate: this.logicalUpdateValue,
      state: this.stateValue,
      wallAccumulator: this.wallAccumulatorValue,
    })
  }
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, finiteOrZero(value)))
}
