import * as THREE from 'three'
import {
  VRM,
  VRMExpressionPresetName,
  VRMLoaderPlugin,
  VRMUtils,
} from '@pixiv/three-vrm'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMAnimation } from '../../lib/VRMAnimation/VRMAnimation'
import { VRMLookAtSmootherLoaderPlugin } from '@/lib/VRMLookAtSmootherLoaderPlugin/VRMLookAtSmootherLoaderPlugin'
import { LipSync } from '../lipSync/lipSync'
import { EmoteController } from '../emoteController/emoteController'
import { Talk } from '../messages/messages'
import { PoseManager } from '@/lib/VRMAnimation/poseManager'
import settingsStore from '@/features/stores/settings'
import {
  getMotionCapabilityProfile,
  type MotionCapabilityProfile,
} from '@/features/motionRuntime/motionCapabilityProfile'
import {
  VRMMotionAdapter,
  type MotionRuntimeFrameRequest,
} from '@/features/motionRuntime/vrmMotionAdapter'
import type { MotionDriverResult } from '@/features/motionRuntime/driverResult'
import {
  compileVRMAnimationToMotionRuntimeAsset,
  type MotionRuntimeAsset,
} from '@/features/motionRuntime/motionAsset'
import { MotionRuntimeSession } from '@/features/motionRuntime/motionRuntimeSession'
import { applyMotionRuntimePoseFrameToVRM } from '@/features/motionRuntime/vrmPoseFrameDriver'
import { createHumanoidRotationChannelId } from '@/features/motionRuntime/motionChannels'
import { MotionRuntimeCompiledTrack } from '@/features/motionRuntime/motionTrackSampler'
import type {
  MotionRuntimeRequestFeedback,
  MotionRuntimeSessionSnapshot,
} from '@/features/motionRuntime/motionRuntimeTypes'

export interface MotionRuntimeDebugSnapshot {
  frameSeq: number
  vrmReady: boolean
  sceneVisible: boolean
  idleNeutralVisualTestMode: boolean
  driverResult: MotionDriverResult | null
  expressionValueSummary: MotionRuntimeExpressionValueSummary
  session: MotionRuntimeSessionSnapshot
  poseFrame: {
    humanoidRotationBoneNames: string[]
    humanoidTranslationBoneNames: string[]
  }
}

export interface MotionRuntimeExpressionValueSummary {
  expression_weight_applied: boolean
  channel_names: string[]
  applied_channel_names: string[]
  dropped_channel_names: string[]
  expression_profile_ref: string | null
  expression_profile_id: string | null
  frame_applied_count: number
  requested_channel_count: number
  applied_channel_count: number
  dropped_channel_count: number
  last_weight_count: number
  last_weight_min: number | null
  last_weight_max: number | null
  target_weight_count: number
  target_weight_min: number | null
  target_weight_max: number | null
  last_driver_result_id: string | null
  last_driver_result: MotionDriverResult['result'] | null
  last_driver_reason_code: string | null
  last_safe_visible_state: MotionDriverResult['safe_visible_state'] | null
  last_observed_at: MotionDriverResult['observed_at'] | null
  last_frame_seq: number | null
}

/**
 * 3Dキャラクターを管理するクラス
 */
export class Model {
  public vrm?: VRM | null
  public mixer?: THREE.AnimationMixer
  public emoteController?: EmoteController
  public currentAction?: THREE.AnimationAction
  public poseYRotationOffset: number = 0
  public poseManager: PoseManager

  private _lookAtTargetParent: THREE.Object3D
  private _lipSync?: LipSync
  private _yOffsetQuat = new THREE.Quaternion()
  private _motionAdapter = new VRMMotionAdapter()
  private _motionRuntimeSession = new MotionRuntimeSession()
  private _queuedMotionFrame: MotionRuntimeFrameRequest | null = null
  private _queuedMotionFrameSequence: MotionRuntimeFrameRequest[] = []
  private _lastMotionDriverResult: MotionDriverResult | null = null
  private _motionRuntimeExpressionValueSummary =
    createEmptyMotionRuntimeExpressionValueSummary()
  private _idleNeutralVisualTestMode = false
  private _motionRuntimeDebugFrameSeq = 0

  constructor(lookAtTargetParent: THREE.Object3D) {
    this._lookAtTargetParent = lookAtTargetParent
    this._lipSync = new LipSync(new AudioContext(), { forceStart: true })
    this.poseManager = new PoseManager()
  }

  public async loadVRM(url: string): Promise<void> {
    const loader = new GLTFLoader()
    loader.register(
      (parser) =>
        new VRMLoaderPlugin(parser, {
          lookAtPlugin: new VRMLookAtSmootherLoaderPlugin(parser),
        })
    )

    const gltf = await loader.loadAsync(url)

    const vrm = (this.vrm = gltf.userData.vrm)
    vrm.scene.name = 'VRMRoot'

    VRMUtils.rotateVRM0(vrm)
    this.mixer = new THREE.AnimationMixer(vrm.scene)

    this.emoteController = new EmoteController(vrm, this._lookAtTargetParent)
    this.applyIdleNeutralVisualTestMode()
  }

  public unLoadVrm() {
    if (this.vrm) {
      VRMUtils.deepDispose(this.vrm.scene)
      this.vrm = null
    }
  }

  /**
   * VRMアニメーションを読み込む
   *
   * https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm_animation-1.0/README.ja.md
   */
  public async loadAnimation(vrmAnimation: VRMAnimation): Promise<void> {
    const { vrm, mixer } = this
    if (vrm == null || mixer == null) {
      throw new Error('You have to load VRM first')
    }

    const clip = vrmAnimation.createAnimationClip(vrm)
    const action = mixer.clipAction(clip)
    this.currentAction = action
    action.play()
  }

  public playMotionRuntimeVRMA(
    vrmAnimation: VRMAnimation,
    args: {
      stimulusId?: string
      groupKey?: string
      requestedAtMs?: number
      loop?: boolean
    } = {}
  ): void {
    const requestedAtMs = args.requestedAtMs ?? Date.now()
    const asset = compileVRMAnimationToMotionRuntimeAsset(vrmAnimation, {
      assetId: args.stimulusId ?? 'motion_runtime_vrma',
      loop: args.loop,
    })
    const channelIds = asset.tracks.map((track) => track.channel.id)
    if (channelIds.length === 0) return

    const feedback = this._motionRuntimeSession.request({
      stimulusId: args.stimulusId ?? 'dance_sequence.local_vrma',
      groupKey: args.groupKey ?? 'dance.sequence',
      requestedAtMs,
      channelIds,
      interruptPolicy: 'replace_same_group',
      suppressionClock: 'advance',
      requiresAsset: true,
    })
    if (feedback.instanceId) {
      this._motionRuntimeSession.attachMotionAsset(
        feedback.instanceId,
        asset,
        requestedAtMs
      )
    }
  }

  public stopMotionRuntimeGroup(
    groupKey = 'dance.sequence',
    nowMs = Date.now(),
    reasonCode = 'query_asset_cleared'
  ): string[] {
    return this._motionRuntimeSession.releaseGroup(groupKey, nowMs, reasonCode)
  }

  public playMotionRuntimeContextNod(
    args: {
      stimulusId?: string
      groupKey?: string
      requestedAtMs?: number
      durationMs?: number
    } = {}
  ): MotionRuntimeRequestFeedback {
    const requestedAtMs = args.requestedAtMs ?? Date.now()
    const durationMs = args.durationMs ?? 900
    const asset = createContextNodMotionRuntimeAsset(
      args.stimulusId ?? 'context_nod'
    )
    const channelIds = asset.tracks.map((track) => track.channel.id)
    const priorityByChannel = Object.fromEntries(
      channelIds.map((channelId) => [channelId, 70])
    )
    const feedback = this._motionRuntimeSession.request({
      stimulusId: args.stimulusId ?? 'context_nod',
      groupKey: args.groupKey ?? 'context.nod',
      requestedAtMs,
      channelIds,
      priorityByChannel,
      interruptPolicy: 'replace_same_group',
      suppressionClock: 'advance',
      durationMs,
      releaseDurationMs: 250,
      requiresAsset: true,
    })

    if (feedback.instanceId) {
      this._motionRuntimeSession.attachMotionAsset(
        feedback.instanceId,
        asset,
        requestedAtMs
      )
    }

    return feedback
  }

  /**
   * 音声を再生し、リップシンクを行う
   */
  public async speak(
    buffer: ArrayBuffer,
    talk: Talk,
    isNeedDecode: boolean = true
  ) {
    this.emoteController?.playEmotion(talk.emotion)

    if (talk.motion) {
      const poseConfig = settingsStore
        .getState()
        .poseConfigs.find((p) => p.id === talk.motion)
      if (poseConfig) {
        void this.poseManager
          .applyPose(this, talk.motion, poseConfig)
          .catch((e) => console.error('Failed to apply pose:', e))
      }
    } else if (this.poseManager.isActive) {
      // モーション指定なしの発話ではアクティブなポーズをリセット
      this.poseManager.resetToIdle(this)
    }

    await new Promise((resolve) => {
      this._lipSync?.playFromArrayBuffer(
        buffer,
        () => {
          resolve(true)
        },
        isNeedDecode
      )
    })
  }

  /**
   * 現在の音声再生を停止
   */
  public stopSpeaking() {
    this._lipSync?.stopCurrentPlayback()
  }

  /**
   * 感情表現を再生する
   */
  public async playEmotion(preset: VRMExpressionPresetName) {
    this.emoteController?.playEmotion(preset)
  }

  public getMotionCapabilityProfile(): MotionCapabilityProfile {
    return getMotionCapabilityProfile()
  }

  public setIdleNeutralVisualTestMode(enabled: boolean): void {
    this._idleNeutralVisualTestMode = enabled
    this.applyIdleNeutralVisualTestMode()
  }

  public isIdleNeutralVisualTestMode(): boolean {
    return this._idleNeutralVisualTestMode
  }

  public queueMotionRuntimeFrame(
    request: MotionRuntimeFrameRequest | null
  ): void {
    this._queuedMotionFrameSequence = []
    if (!request) {
      this._queuedMotionFrame = null
      return
    }

    const frames = createExpressionWeightFrameSequence(request)
    this._queuedMotionFrame = frames.shift() ?? request
    this._queuedMotionFrameSequence = frames
  }

  public getLastMotionDriverResult(): MotionDriverResult | null {
    return this._lastMotionDriverResult
  }

  public finalizeMotionDriverResult(): MotionDriverResult | null {
    const finalized = this._motionAdapter.finalizeDriverResult(
      this._lastMotionDriverResult
    )
    if (finalized) this._lastMotionDriverResult = finalized
    return this._lastMotionDriverResult
  }

  public getMotionRuntimeDebugSnapshot(): MotionRuntimeDebugSnapshot {
    const poseFrame = this._motionRuntimeSession.getLastPoseFrame()
    return {
      frameSeq: this._motionRuntimeDebugFrameSeq,
      vrmReady: Boolean(this.vrm),
      sceneVisible: Boolean(this.vrm?.scene.visible),
      idleNeutralVisualTestMode: this._idleNeutralVisualTestMode,
      driverResult: this._lastMotionDriverResult,
      expressionValueSummary: {
        ...this._motionRuntimeExpressionValueSummary,
        channel_names: [
          ...this._motionRuntimeExpressionValueSummary.channel_names,
        ],
      },
      session: this._motionRuntimeSession.snapshot(),
      poseFrame: {
        humanoidRotationBoneNames: [...poseFrame.humanoidRotations.keys()],
        humanoidTranslationBoneNames: [
          ...poseFrame.humanoidTranslations.keys(),
        ],
      },
    }
  }

  public update(delta: number): void {
    const freezeNonTargetVisualMotion = this._idleNeutralVisualTestMode
    const queuedMotionFrame = this._queuedMotionFrame
    const motionRuntimeFrame =
      freezeNonTargetVisualMotion &&
      !shouldApplyQueuedMotionFrameInFrozenVisualTestMode(queuedMotionFrame)
        ? null
        : queuedMotionFrame

    if (!freezeNonTargetVisualMotion && this._lipSync) {
      const { volume } = this._lipSync.update()
      this.emoteController?.lipSync('aa', volume)
    }

    if (!freezeNonTargetVisualMotion) {
      this.emoteController?.update(delta)
      this.mixer?.update(delta)
    }

    if (
      !freezeNonTargetVisualMotion &&
      this.poseYRotationOffset !== 0 &&
      this.vrm
    ) {
      const hipsNode = this.vrm.humanoid.getNormalizedBoneNode('hips')
      if (hipsNode) {
        this._yOffsetQuat.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          this.poseYRotationOffset
        )
        hipsNode.quaternion.premultiply(this._yOffsetQuat)
      }
    }

    const motionDriverResult = this._motionAdapter.applyFrame(
      {
        expressionManager: this.vrm?.expressionManager ?? null,
        lookAt: this.vrm?.lookAt ?? null,
        lookAtTargetParent: this._lookAtTargetParent,
        resetToIdle: () => {
          if (!this.mixer) return false
          this.poseManager.resetToIdle(this)
          this.emoteController?.playEmotion('neutral')
          return true
        },
      },
      motionRuntimeFrame
    )
    if (motionDriverResult) {
      this._lastMotionDriverResult = motionDriverResult
      this._motionRuntimeExpressionValueSummary =
        createMotionRuntimeExpressionValueSummary(
          this._motionRuntimeExpressionValueSummary,
          motionRuntimeFrame,
          motionDriverResult,
          this._motionRuntimeDebugFrameSeq
        )
    }
    this._queuedMotionFrame = this._queuedMotionFrameSequence.shift() ?? null

    if (this.vrm) {
      this._motionRuntimeSession.tick(Date.now())
      applyMotionRuntimePoseFrameToVRM(
        this.vrm,
        this._motionRuntimeSession.getLastPoseFrame()
      )
      this._motionRuntimeDebugFrameSeq += 1
    }

    this.vrm?.update(freezeNonTargetVisualMotion ? 0 : delta)
  }

  private applyIdleNeutralVisualTestMode(): void {
    if (this._idleNeutralVisualTestMode) {
      this._lipSync?.stopCurrentPlayback()
      this.poseYRotationOffset = 0
      this.currentAction?.stop()
      this.currentAction = undefined
      this.mixer?.stopAllAction()
      this.emoteController?.playEmotion('neutral')
    }

    this.emoteController?.setIdleNeutralVisualTestMode(
      this._idleNeutralVisualTestMode
    )

    const lookAt = this.vrm?.lookAt as
      | ({ enableSaccade?: boolean } & object)
      | undefined

    if (lookAt && 'enableSaccade' in lookAt) {
      lookAt.enableSaccade = !this._idleNeutralVisualTestMode
    }
  }
}

function createContextNodMotionRuntimeAsset(
  assetId: string
): MotionRuntimeAsset {
  const tracks = [
    createNodRotationTrack('neck', 0.07),
    createNodRotationTrack('head', 0.15),
  ]

  return {
    assetId,
    loop: false,
    durationSec: 0.9,
    tracks,
    trackByChannelId: new Map(
      tracks.map((track) => [track.channel.id, track] as const)
    ),
  }
}

export function shouldApplyQueuedMotionFrameInFrozenVisualTestMode(
  request?: MotionRuntimeFrameRequest | null
): boolean {
  return isExpressionWeightOnlyFrame(request)
}

export function createEmptyMotionRuntimeExpressionValueSummary(): MotionRuntimeExpressionValueSummary {
  return {
    expression_weight_applied: false,
    channel_names: [],
    applied_channel_names: [],
    dropped_channel_names: [],
    expression_profile_ref: null,
    expression_profile_id: null,
    frame_applied_count: 0,
    requested_channel_count: 0,
    applied_channel_count: 0,
    dropped_channel_count: 0,
    last_weight_count: 0,
    last_weight_min: null,
    last_weight_max: null,
    target_weight_count: 0,
    target_weight_min: null,
    target_weight_max: null,
    last_driver_result_id: null,
    last_driver_result: null,
    last_driver_reason_code: null,
    last_safe_visible_state: null,
    last_observed_at: null,
    last_frame_seq: null,
  }
}

export function createMotionRuntimeExpressionValueSummary(
  previousSummary: MotionRuntimeExpressionValueSummary,
  request: MotionRuntimeFrameRequest | null,
  driverResult: MotionDriverResult,
  frameSeq: number
): MotionRuntimeExpressionValueSummary {
  const expressionPart = driverResult.per_part_results.find(
    (partResult) => partResult.part === 'expression'
  )
  if (!expressionPart) return previousSummary

  const weights = Object.entries(request?.expressionWeights ?? {}).filter(
    (entry): entry is [string, number] =>
      isSafeDiagnosticLabel(entry[0]) &&
      typeof entry[1] === 'number' &&
      Number.isFinite(entry[1])
  )
  const weightValues = weights.map(([, weight]) =>
    Math.min(1, Math.max(0, weight))
  )
  const targetWeights = Object.entries(
    request?.expressionTargetWeights ?? request?.expressionWeights ?? {}
  ).filter(
    (entry): entry is [string, number] =>
      isSafeDiagnosticLabel(entry[0]) &&
      typeof entry[1] === 'number' &&
      Number.isFinite(entry[1])
  )
  const targetWeightValues = targetWeights.map(([, weight]) =>
    Math.min(1, Math.max(0, weight))
  )
  const frameAppliedCount =
    previousSummary.frame_applied_count +
    (expressionPart.result === 'applied' ? 1 : 0)
  const appliedChannelNames = safeDiagnosticLabels(
    expressionPart.applied_channel_names
  )
  const droppedChannelNames = safeDiagnosticLabels(
    expressionPart.dropped_channel_names
  )
  const requestedChannelCount = safeDiagnosticCount(
    expressionPart.requested_channel_count,
    weights.length
  )
  const appliedChannelCount = safeDiagnosticCount(
    expressionPart.applied_channel_count,
    expressionPart.result === 'applied' ? weights.length : 0
  )
  const droppedChannelCount = safeDiagnosticCount(
    expressionPart.dropped_channel_count,
    Math.max(0, requestedChannelCount - appliedChannelCount)
  )

  return {
    expression_weight_applied: expressionPart.result === 'applied',
    channel_names: weights
      .map(([channelName]) => channelName)
      .sort()
      .slice(0, 8),
    applied_channel_names: appliedChannelNames,
    dropped_channel_names: droppedChannelNames,
    expression_profile_ref:
      safeDiagnosticLabelOrNull(request?.expressionProfileRef) ??
      previousSummary.expression_profile_ref,
    expression_profile_id:
      safeDiagnosticLabelOrNull(request?.expressionProfileId) ??
      previousSummary.expression_profile_id,
    frame_applied_count: frameAppliedCount,
    requested_channel_count: requestedChannelCount,
    applied_channel_count: appliedChannelCount,
    dropped_channel_count: droppedChannelCount,
    last_weight_count: weightValues.length,
    last_weight_min: weightValues.length > 0 ? Math.min(...weightValues) : null,
    last_weight_max: weightValues.length > 0 ? Math.max(...weightValues) : null,
    target_weight_count: targetWeightValues.length,
    target_weight_min:
      targetWeightValues.length > 0 ? Math.min(...targetWeightValues) : null,
    target_weight_max:
      targetWeightValues.length > 0 ? Math.max(...targetWeightValues) : null,
    last_driver_result_id: driverResult.driver_result_id,
    last_driver_result: driverResult.result,
    last_driver_reason_code: driverResult.reason_code,
    last_safe_visible_state: driverResult.safe_visible_state,
    last_observed_at: driverResult.observed_at,
    last_frame_seq: frameSeq,
  }
}

export function createExpressionWeightFrameSequence(
  request: MotionRuntimeFrameRequest
): MotionRuntimeFrameRequest[] {
  if (!isExpressionWeightOnlyFrame(request)) return [request]

  const frameCount = normalizeExpressionWeightFrameCount(request.frameCount)
  if (frameCount <= 1) return [request]

  return Array.from({ length: frameCount }, (_, index) => ({
    ...request,
    frameCount,
    expressionTargetWeights:
      request.expressionTargetWeights ?? request.expressionWeights,
    expressionWeights: scaleExpressionWeights(
      request.expressionWeights,
      (index + 1) / frameCount
    ),
  }))
}

function isExpressionWeightOnlyFrame(
  request?: MotionRuntimeFrameRequest | null
): request is MotionRuntimeFrameRequest & {
  expressionWeights: NonNullable<MotionRuntimeFrameRequest['expressionWeights']>
} {
  return Boolean(
    request?.expressionWeights &&
    Object.keys(request.expressionWeights).length > 0 &&
    !request.lookAtTarget &&
    !request.resetToIdle
  )
}

function normalizeExpressionWeightFrameCount(frameCount?: number): number {
  if (typeof frameCount !== 'number' || !Number.isFinite(frameCount)) return 1
  return Math.max(1, Math.min(30, Math.floor(frameCount)))
}

function isSafeDiagnosticLabel(value: string): boolean {
  return /^[a-zA-Z0-9._:-]{1,64}$/.test(value)
}

function safeDiagnosticLabelOrNull(value?: string): string | null {
  return typeof value === 'string' && isSafeDiagnosticLabel(value)
    ? value
    : null
}

function safeDiagnosticLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && isSafeDiagnosticLabel(entry)
    )
    .sort()
    .slice(0, 8)
}

function safeDiagnosticCount(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }
  return Math.max(0, Math.floor(fallback))
}

function scaleExpressionWeights(
  weights: NonNullable<MotionRuntimeFrameRequest['expressionWeights']>,
  multiplier: number
): MotionRuntimeFrameRequest['expressionWeights'] {
  return Object.fromEntries(
    Object.entries(weights).map(([name, weight]) => {
      if (typeof weight !== 'number' || !Number.isFinite(weight)) {
        return [name, weight]
      }
      return [name, Math.min(1, Math.max(0, weight * multiplier))]
    })
  )
}

function createNodRotationTrack(
  boneName: string,
  radians: number
): MotionRuntimeCompiledTrack {
  const axis = new THREE.Vector3(1, 0, 0)
  const neutral = new THREE.Quaternion()
  const down = new THREE.Quaternion().setFromAxisAngle(axis, radians)
  const rebound = new THREE.Quaternion().setFromAxisAngle(axis, -radians * 0.35)
  const values = [
    ...neutral.toArray(),
    ...down.toArray(),
    ...rebound.toArray(),
    ...neutral.toArray(),
  ]

  return new MotionRuntimeCompiledTrack({
    channel: {
      id: createHumanoidRotationChannelId(boneName),
      kind: 'humanoidRotation',
      boneName,
    },
    valueKind: 'quaternion',
    times: [0, 0.22, 0.48, 0.9],
    values,
    loop: false,
  })
}
