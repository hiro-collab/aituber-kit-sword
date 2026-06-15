import * as THREE from 'three'
import type { MotionRuntimeChannelDesc } from './motionRuntimeTypes'

export type MotionRuntimeTrackValueKind = 'quaternion' | 'vector3'

export interface MotionRuntimeSampledValue {
  kind: MotionRuntimeTrackValueKind
  quaternion?: THREE.Quaternion
  vector?: THREE.Vector3
}

export interface MotionRuntimeCompiledTrackArgs {
  channel: MotionRuntimeChannelDesc
  valueKind: MotionRuntimeTrackValueKind
  times: ArrayLike<number>
  values: ArrayLike<number>
  loop?: boolean
}

export class MotionRuntimeCompiledTrack {
  public readonly channel: MotionRuntimeChannelDesc
  public readonly valueKind: MotionRuntimeTrackValueKind
  public readonly times: Float32Array
  public readonly values: Float32Array
  public readonly durationSec: number
  public readonly loop: boolean

  private lastIndex = 0
  private q0 = new THREE.Quaternion()
  private q1 = new THREE.Quaternion()
  private v0 = new THREE.Vector3()
  private v1 = new THREE.Vector3()

  public constructor(args: MotionRuntimeCompiledTrackArgs) {
    this.channel = args.channel
    this.valueKind = args.valueKind
    this.times = Float32Array.from(Array.from(args.times))
    this.values = Float32Array.from(Array.from(args.values))
    this.durationSec = this.times[this.times.length - 1] ?? 0
    this.loop = Boolean(args.loop)
    this.validate()
  }

  public sample(timeSec: number): MotionRuntimeSampledValue {
    const sampleTime = this.resolveSampleTime(timeSec)
    const index = this.findKeyframeIndex(sampleTime)

    if (this.valueKind === 'quaternion') {
      return {
        kind: 'quaternion',
        quaternion: this.sampleQuaternion(index, sampleTime),
      }
    }

    return {
      kind: 'vector3',
      vector: this.sampleVector(index, sampleTime),
    }
  }

  private sampleQuaternion(
    index: number,
    sampleTime: number
  ): THREE.Quaternion {
    const first = this.readQuaternion(index, this.q0)
    if (index >= this.times.length - 1) return first.clone()

    const next = this.readQuaternion(index + 1, this.q1)
    if (first.dot(next) < 0) {
      next.set(-next.x, -next.y, -next.z, -next.w)
    }

    const alpha = this.interpolateAlpha(index, sampleTime)
    return first.clone().slerp(next, alpha).normalize()
  }

  private sampleVector(index: number, sampleTime: number): THREE.Vector3 {
    const first = this.readVector(index, this.v0)
    if (index >= this.times.length - 1) return first.clone()

    const next = this.readVector(index + 1, this.v1)
    const alpha = this.interpolateAlpha(index, sampleTime)
    return first.clone().lerp(next, alpha)
  }

  private readQuaternion(index: number, target: THREE.Quaternion) {
    const offset = index * 4
    return target
      .set(
        this.values[offset] ?? 0,
        this.values[offset + 1] ?? 0,
        this.values[offset + 2] ?? 0,
        this.values[offset + 3] ?? 1
      )
      .normalize()
  }

  private readVector(index: number, target: THREE.Vector3) {
    const offset = index * 3
    return target.set(
      this.values[offset] ?? 0,
      this.values[offset + 1] ?? 0,
      this.values[offset + 2] ?? 0
    )
  }

  private interpolateAlpha(index: number, sampleTime: number): number {
    const current = this.times[index] ?? 0
    const next = this.times[index + 1] ?? current
    const duration = Math.max(1e-6, next - current)
    return Math.min(1, Math.max(0, (sampleTime - current) / duration))
  }

  private resolveSampleTime(timeSec: number): number {
    const finite = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0
    if (this.loop && this.durationSec > 0) {
      return finite % this.durationSec
    }
    return Math.min(finite, this.durationSec)
  }

  private findKeyframeIndex(sampleTime: number): number {
    if (this.times.length <= 1) return 0

    if (
      this.lastIndex < this.times.length - 1 &&
      sampleTime >= this.times[this.lastIndex] &&
      sampleTime <= this.times[this.lastIndex + 1]
    ) {
      return this.lastIndex
    }

    let low = 0
    let high = this.times.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      const value = this.times[mid]
      if (value <= sampleTime) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }

    this.lastIndex = Math.min(Math.max(0, high), this.times.length - 1)
    return this.lastIndex
  }

  private validate(): void {
    if (this.times.length === 0) {
      throw new Error('MotionRuntimeCompiledTrack requires at least one time')
    }
    const valueSize = this.valueKind === 'quaternion' ? 4 : 3
    if (this.values.length !== this.times.length * valueSize) {
      throw new Error(
        `MotionRuntimeCompiledTrack values length must be times length * ${valueSize}`
      )
    }
  }
}
