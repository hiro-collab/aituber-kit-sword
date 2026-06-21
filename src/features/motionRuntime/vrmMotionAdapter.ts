import * as THREE from 'three'
import {
  getMotionCapabilityProfile,
  type MotionCapabilityProfile,
} from './motionCapabilityProfile'
import {
  createMotionDriverResult,
  finalizeMotionDriverResult,
  type MotionDriverPartResult,
  type MotionDriverResult,
} from './driverResult'

export interface MotionRuntimeLookAtTarget {
  x?: number
  y?: number
  z?: number
  release?: boolean
}

export interface MotionRuntimeFrameRequest {
  stimulusInstanceId?: string
  frameCount?: number
  expressionWeights?: Record<string, number | null | undefined>
  lookAtTarget?: MotionRuntimeLookAtTarget
  resetToIdle?: boolean
}

export interface VRMMotionAdapterSurface {
  expressionManager?: {
    getExpression?: (name: string) => unknown | null
    setValue: (name: string, value: number) => void
  } | null
  lookAt?: {
    target?: THREE.Object3D | null
  } | null
  lookAtTargetParent?: THREE.Object3D | null
  resetToIdle?: () => boolean
}

export class VRMMotionAdapter {
  private readonly capabilityProfile: MotionCapabilityProfile
  private motionLookAtTarget: THREE.Object3D | null = null
  private originalLookAtTarget: THREE.Object3D | null = null
  private hasOriginalLookAtTarget = false

  constructor(
    capabilityProfile: MotionCapabilityProfile = getMotionCapabilityProfile()
  ) {
    this.capabilityProfile = capabilityProfile
  }

  public getCapabilityProfile(): MotionCapabilityProfile {
    return { ...this.capabilityProfile }
  }

  public applyFrame(
    surface: VRMMotionAdapterSurface,
    request?: MotionRuntimeFrameRequest | null
  ): MotionDriverResult | null {
    if (!hasMotionRequest(request)) return null

    const partResults: MotionDriverPartResult[] = []

    if (request.expressionWeights) {
      partResults.push(this.applyExpressionWeights(surface, request))
    }

    if (request.lookAtTarget) {
      partResults.push(this.applyLookAtTarget(surface, request.lookAtTarget))
    }

    if (request.resetToIdle) {
      partResults.push(this.applyResetToIdle(surface))
    }

    return createMotionDriverResult({
      stimulusInstanceId: request.stimulusInstanceId,
      perPartResults: partResults,
      frameCount: request.frameCount,
    })
  }

  public finalizeDriverResult(
    result: MotionDriverResult | null
  ): MotionDriverResult | null {
    return result ? finalizeMotionDriverResult(result) : null
  }

  private applyExpressionWeights(
    surface: VRMMotionAdapterSurface,
    request: MotionRuntimeFrameRequest
  ): MotionDriverPartResult {
    const entries = Object.entries(request.expressionWeights ?? {}).filter(
      ([, weight]) => typeof weight === 'number' && Number.isFinite(weight)
    ) as Array<[string, number]>

    if (entries.length === 0) {
      return {
        part: 'expression',
        result: 'degraded',
        capability: this.capabilityProfile.expressionWeight,
        reason_code: 'expression_weight_empty',
        safe_visible_state: 'no_visible_change',
      }
    }

    if (!surface.expressionManager) {
      return {
        part: 'expression',
        result: 'unavailable',
        capability: 'unavailable',
        reason_code: 'expression_manager_unavailable',
        safe_visible_state: 'unknown',
      }
    }

    const supportedEntries = entries.filter(([name]) => {
      if (!surface.expressionManager?.getExpression) return true
      return surface.expressionManager.getExpression(name) !== null
    })

    if (supportedEntries.length === 0) {
      return {
        part: 'expression',
        result: 'degraded',
        capability: this.capabilityProfile.expressionWeight,
        reason_code: 'expression_weight_no_supported_channel',
        safe_visible_state: 'no_visible_change',
      }
    }

    for (const [name, weight] of supportedEntries) {
      surface.expressionManager.setValue(name, clamp01(weight))
    }

    return {
      part: 'expression',
      result: 'applied',
      capability: this.capabilityProfile.expressionWeight,
      reason_code: 'expression_weight_applied',
      safe_visible_state: 'expression_changed',
    }
  }

  private applyLookAtTarget(
    surface: VRMMotionAdapterSurface,
    target: MotionRuntimeLookAtTarget
  ): MotionDriverPartResult {
    if (target.release) {
      this.restoreLookAtTarget(surface)
      return {
        part: 'gaze',
        result: 'stopped',
        capability: this.capabilityProfile.lookAtTarget,
        reason_code: 'look_at_target_restored',
        safe_visible_state: 'no_visible_change',
      }
    }

    if (!surface.lookAt || !surface.lookAtTargetParent) {
      return {
        part: 'gaze',
        result: 'unavailable',
        capability: 'unavailable',
        reason_code: 'look_at_target_surface_unavailable',
        safe_visible_state: 'unknown',
      }
    }

    const x = finiteOrZero(target.x)
    const y = finiteOrZero(target.y)
    const z = finiteOrZero(target.z)

    if (!this.hasOriginalLookAtTarget) {
      this.originalLookAtTarget = surface.lookAt.target ?? null
      this.hasOriginalLookAtTarget = true
    }

    if (!this.motionLookAtTarget) {
      this.motionLookAtTarget = new THREE.Object3D()
      this.motionLookAtTarget.name = 'MotionRuntimeLookAtTarget'
    }

    if (this.motionLookAtTarget.parent !== surface.lookAtTargetParent) {
      surface.lookAtTargetParent.add(this.motionLookAtTarget)
    }

    this.motionLookAtTarget.position.set(x, y, z)
    surface.lookAt.target = this.motionLookAtTarget

    return {
      part: 'gaze',
      result: 'applied',
      capability: this.capabilityProfile.lookAtTarget,
      reason_code: 'look_at_target_applied',
      safe_visible_state: 'gaze_target_changed',
    }
  }

  private applyResetToIdle(
    surface: VRMMotionAdapterSurface
  ): MotionDriverPartResult {
    this.restoreLookAtTarget(surface)

    if (!surface.resetToIdle) {
      return {
        part: 'reset',
        result: 'unavailable',
        capability: 'unavailable',
        reason_code: 'reset_to_idle_surface_unavailable',
        safe_visible_state: 'unknown',
      }
    }

    const didReset = surface.resetToIdle()

    return {
      part: 'reset',
      result: didReset ? 'stopped' : 'degraded',
      capability: this.capabilityProfile.resetToIdle,
      reason_code: didReset ? 'reset_to_idle_requested' : 'reset_to_idle_noop',
      safe_visible_state: 'neutral_idle_requested',
    }
  }

  private restoreLookAtTarget(surface: VRMMotionAdapterSurface): void {
    if (surface.lookAt && this.hasOriginalLookAtTarget) {
      surface.lookAt.target = this.originalLookAtTarget
    }

    if (this.motionLookAtTarget?.parent) {
      this.motionLookAtTarget.parent.remove(this.motionLookAtTarget)
    }

    this.motionLookAtTarget = null
    this.originalLookAtTarget = null
    this.hasOriginalLookAtTarget = false
  }
}

function hasMotionRequest(
  request?: MotionRuntimeFrameRequest | null
): request is MotionRuntimeFrameRequest {
  return Boolean(
    request &&
    ((request.expressionWeights &&
      Object.keys(request.expressionWeights).length > 0) ||
      request.lookAtTarget ||
      request.resetToIdle)
  )
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function finiteOrZero(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}
