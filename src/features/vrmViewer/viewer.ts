import * as THREE from 'three'
import { Model, type MotionRuntimeDebugSnapshot } from './model'
import { loadVRMAnimation } from '@/lib/VRMAnimation/loadVRMAnimation'
import { buildUrl } from '@/utils/buildUrl'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import settingsStore from '@/features/stores/settings'
import {
  DANCE_SEQUENCE_GROUP_KEY,
  receiveMotionStimulusV0,
  type MotionStimulusRuntimeExpressionVisibleRequest,
  type MotionStimulusReceiverResult,
  type MotionStimulusRuntimeContextNodRequest,
  type MotionStimulusRuntimeStopRequest,
  type MotionStimulusRuntimeStartRequest,
  type MotionStimulusRuntimeStartResult,
} from '@/features/motionRuntime/motionStimulusReceiver'

export const PROJECTION_VISUAL_IN_PAGE_DIAGNOSTICS_GLOBAL =
  '__projectionVisualInPageDiagnosticsV0'
export const PROJECTION_VISUAL_IN_PAGE_DIAGNOSTICS_SCHEMA_VERSION =
  'projection_visual_in_page_diagnostics.v0'
export const PROJECTION_VISUAL_ROI_REGISTRY_VERSION =
  'projection_visual_roi_registry.v0'

export interface ProjectionVisualInPageDiagnosticsV0 {
  schema_version: typeof PROJECTION_VISUAL_IN_PAGE_DIAGNOSTICS_SCHEMA_VERSION
  visual_session_id: string
  projection_visual_instance_id: string
  surface_class: 'avatar_webgl_canvas'
  surface_instance_id: string
  roi_registry_version: typeof PROJECTION_VISUAL_ROI_REGISTRY_VERSION
  frame_seq: number
  frame_timestamp_mono_ms: number
  visual_heartbeat: {
    status: 'fresh'
    frame_seq: number
    frame_timestamp_mono_ms: number
    freshness_age_ms: 0
  }
  runtime_refs: {
    motion_event_id: string | null
    stimulus_id: string | null
    stimulus_instance_id: string | null
    runtime_result_id: string | null
    driver_result_id: string | null
    multi_stimulus_group_id: string | null
    accepted: boolean | null
    status: string | null
    reason_code: string | null
    safe_visible_state: string | null
  }
  runtime_anchors: Partial<
    Record<
      'request_issued' | 'runtime_accepted' | 'runtime_started' | 'result',
      {
        status: string
        reason_code: string
        at_ms: number
      }
    >
  >
  driver_frame_anchor: {
    frame_seq: number
    frame_timestamp_mono_ms: number
    driver_result_id: string | null
    observed_at: string | null
    reason_code: string | null
    safe_visible_state: string | null
  }
  expression_value_summary: MotionRuntimeDebugSnapshot['expressionValueSummary']
  mixed_surface_separation: {
    avatar_canvas_surface_class: 'avatar_webgl_canvas'
    dom_overlay_surface_classes: [
      'hud_dom_overlay',
      'speech_bubble_dom_overlay',
    ]
    dom_overlay_is_not_avatar_canvas_proof: true
    avatar_canvas_is_not_dom_overlay_proof: true
  }
}

export interface ViewerLoadOptions {
  idleNeutralVisualTestMode?: boolean
}

/**
 * three.jsを使った3Dビューワー
 *
 * setup()でcanvasを渡してから使う
 */
export class Viewer {
  public isReady: boolean
  public model?: Model

  private _renderer?: THREE.WebGLRenderer
  private _clock: THREE.Clock
  private _scene: THREE.Scene
  private _camera?: THREE.PerspectiveCamera
  private _cameraControls?: OrbitControls
  private _directionalLight?: THREE.DirectionalLight
  private _ambientLight?: THREE.AmbientLight
  private _settingsUnsubscribe?: () => void
  private _motionRuntimeAssetPath?: string
  private _loadedMotionRuntimeAssetPath?: string
  private _loadedMotionRuntimeModel?: Model
  private _motionRuntimeAssetLoadToken = 0
  private _visualSessionId =
    createProjectionVisualDiagnosticsId('visual-session')
  private _projectionVisualInstanceId = createProjectionVisualDiagnosticsId(
    'projection-visual-instance'
  )
  private _avatarCanvasSurfaceInstanceId = createProjectionVisualDiagnosticsId(
    'avatar-webgl-canvas'
  )

  constructor() {
    this.isReady = false

    // scene
    const scene = new THREE.Scene()
    this._scene = scene

    // light
    const lightingIntensity = settingsStore.getState().lightingIntensity
    this._directionalLight = new THREE.DirectionalLight(
      0xffffff,
      1.8 * lightingIntensity
    )
    this._directionalLight.position.set(1.0, 1.0, 1.0).normalize()
    scene.add(this._directionalLight)

    this._ambientLight = new THREE.AmbientLight(
      0xffffff,
      1.2 * lightingIntensity
    )
    scene.add(this._ambientLight)

    // animate
    this._clock = new THREE.Clock()
    this._clock.start()
  }

  public loadVrm(url: string, options: ViewerLoadOptions = {}): Promise<void> {
    if (this.model?.vrm) {
      this.unloadVRM()
    }

    // gltf and vrm
    const model = new Model(this._camera || new THREE.Object3D())
    this.model = model
    this._loadedMotionRuntimeAssetPath = undefined
    this._loadedMotionRuntimeModel = undefined
    this._motionRuntimeAssetLoadToken += 1
    model.setIdleNeutralVisualTestMode(
      Boolean(options.idleNeutralVisualTestMode)
    )
    return model.loadVRM(url).then(async () => {
      if (this.model !== model || !model.vrm) return

      // Disable frustum culling
      model.vrm.scene.traverse((obj) => {
        obj.frustumCulled = false
      })

      model.vrm.scene.visible = false
      this._scene.add(model.vrm.scene)

      try {
        if (!options.idleNeutralVisualTestMode) {
          const vrma = await loadVRMAnimation(buildUrl('/idle_loop.vrma'))
          if (vrma && this.model === model) model.loadAnimation(vrma)
        }
      } catch {
        console.warn('Failed to load idle VRMA animation', {
          reason_code: 'idle_vrma_load_failed',
        })
      } finally {
        model.vrm.scene.visible = true
      }

      // HACK: アニメーションの原点がずれているので再生後にカメラ位置を調整する
      requestAnimationFrame(() => {
        this.resetCamera()
      })

      void this.playPendingMotionRuntimeAsset()
    })
  }

  public setMotionRuntimeAssetPath(path?: string): void {
    this._motionRuntimeAssetPath = path
    this._motionRuntimeAssetLoadToken += 1
    if (!path) {
      this._loadedMotionRuntimeAssetPath = undefined
      this._loadedMotionRuntimeModel = undefined
      this.model?.stopMotionRuntimeGroup('dance.sequence')
      return
    }
    void this.playPendingMotionRuntimeAsset()
  }

  public receiveMotionStimulus(
    stimulus: unknown
  ): Promise<MotionStimulusReceiverResult> {
    return receiveMotionStimulusV0(stimulus, {
      startDance: (request) =>
        this.startMotionRuntimeDanceFromStimulus(request),
      startContextNod: (request) =>
        this.startMotionRuntimeContextNodFromStimulus(request),
      startExpressionVisible: (request) =>
        this.startMotionRuntimeExpressionVisibleFromStimulus(request),
      stopDance: (request) => this.stopMotionRuntimeDanceFromStimulus(request),
    })
  }

  private async playPendingMotionRuntimeAsset(): Promise<void> {
    const path = this._motionRuntimeAssetPath
    const model = this.model
    if (!path || !model?.vrm) return
    if (
      this._loadedMotionRuntimeAssetPath === path &&
      this._loadedMotionRuntimeModel === model
    ) {
      return
    }
    const loadToken = ++this._motionRuntimeAssetLoadToken
    this._loadedMotionRuntimeAssetPath = path
    this._loadedMotionRuntimeModel = model

    try {
      const vrma = await loadVRMAnimation(buildUrl(path))
      if (
        loadToken !== this._motionRuntimeAssetLoadToken ||
        this._motionRuntimeAssetPath !== path ||
        this.model !== model ||
        !model.vrm
      ) {
        return
      }
      if (vrma) {
        model.playMotionRuntimeVRMA(vrma, {
          stimulusId: 'dance_sequence.query_vrma',
          groupKey: 'dance.sequence',
          loop: true,
        })
      }
    } catch {
      if (loadToken === this._motionRuntimeAssetLoadToken) {
        this._loadedMotionRuntimeAssetPath = undefined
        this._loadedMotionRuntimeModel = undefined
      }
      console.warn('Motion Runtime query VRMA unavailable', {
        reason_code: 'motion_query_asset_load_failed',
      })
    }
  }

  private async startMotionRuntimeDanceFromStimulus(
    request: MotionStimulusRuntimeStartRequest
  ): Promise<MotionStimulusRuntimeStartResult> {
    const model = this.model
    if (!model?.vrm) {
      return {
        status: 'unavailable',
        reason_code: 'vrm_model_not_ready',
        safe_visible_state: 'no_visible_change',
      }
    }

    const loadToken = ++this._motionRuntimeAssetLoadToken
    try {
      const vrma = await loadVRMAnimation(buildUrl(request.assetPath))
      if (
        loadToken !== this._motionRuntimeAssetLoadToken ||
        this.model !== model ||
        !model.vrm
      ) {
        return {
          status: 'degraded',
          reason_code: 'motion_stimulus_start_stale',
          safe_visible_state: 'unknown',
        }
      }
      if (!vrma) {
        return {
          status: 'unavailable',
          reason_code: 'motion_asset_unavailable',
          safe_visible_state: 'no_visible_change',
        }
      }

      model.playMotionRuntimeVRMA(vrma, {
        stimulusId: request.stimulusId,
        groupKey: request.groupKey,
        requestedAtMs: request.requestedAtMs,
        loop: request.loop,
      })
      return {
        status: 'started',
        reason_code: 'motion_runtime_vrma_started',
        runtime_result_id:
          request.trace.runtime_result_id ?? request.trace.driver_result_id,
        safe_visible_state: 'motion_started',
      }
    } catch {
      console.warn('Motion Runtime dance asset unavailable', {
        reason_code: 'motion_asset_load_failed',
      })
      return {
        status: 'unavailable',
        reason_code: 'motion_asset_load_failed',
        safe_visible_state: 'no_visible_change',
      }
    }
  }

  private stopMotionRuntimeDanceFromStimulus(
    request: MotionStimulusRuntimeStopRequest
  ): MotionStimulusRuntimeStartResult {
    const model = this.model
    if (!model?.vrm) {
      return {
        status: 'unavailable',
        reason_code: 'vrm_model_not_ready',
        safe_visible_state: 'no_visible_change',
      }
    }

    this._motionRuntimeAssetPath = undefined
    this._loadedMotionRuntimeAssetPath = undefined
    this._loadedMotionRuntimeModel = undefined
    this._motionRuntimeAssetLoadToken += 1
    const releasedInstanceIds = model.stopMotionRuntimeGroup(
      request.groupKey || DANCE_SEQUENCE_GROUP_KEY,
      request.requestedAtMs,
      'motion_runtime_stop_requested'
    )
    model.queueMotionRuntimeFrame({
      stimulusInstanceId: request.stimulusInstanceId,
      frameCount: 1,
      resetToIdle: true,
    })

    return {
      status: 'completed',
      reason_code:
        releasedInstanceIds.length > 0
          ? 'motion_stopped'
          : 'motion_runtime_stop_requested',
      runtime_result_id:
        request.trace.runtime_result_id ?? request.trace.driver_result_id,
      safe_visible_state: 'neutral_idle_requested',
    }
  }

  private startMotionRuntimeContextNodFromStimulus(
    request: MotionStimulusRuntimeContextNodRequest
  ): MotionStimulusRuntimeStartResult {
    const model = this.model
    if (!model?.vrm) {
      return {
        status: 'unavailable',
        reason_code: 'vrm_model_not_ready',
        safe_visible_state: 'no_visible_change',
      }
    }

    const feedback = model.playMotionRuntimeContextNod({
      stimulusId: request.stimulusId,
      groupKey: request.groupKey,
      requestedAtMs: request.requestedAtMs,
      durationMs: request.durationMs,
    })

    if (!feedback.accepted) {
      return {
        status: 'failed_safe',
        reason_code: feedback.reasonCode,
        runtime_result_id: request.trace.runtime_result_id,
        safe_visible_state: 'no_visible_change',
      }
    }

    return {
      status: 'completed',
      reason_code: 'motion_runtime_context_nod_completed',
      runtime_result_id: request.trace.runtime_result_id,
      safe_visible_state: 'context_nod_completed',
    }
  }

  private startMotionRuntimeExpressionVisibleFromStimulus(
    request: MotionStimulusRuntimeExpressionVisibleRequest
  ): MotionStimulusRuntimeStartResult {
    const model = this.model
    if (!model?.vrm) {
      return {
        status: 'unavailable',
        reason_code: 'vrm_model_not_ready',
        safe_visible_state: 'no_visible_change',
      }
    }

    model.queueMotionRuntimeFrame({
      stimulusInstanceId: request.stimulusInstanceId,
      frameCount: request.frameCount,
      expressionProfileRef: request.expressionProfileRef,
      expressionProfileId: request.expressionProfileId,
      expressionWeights: request.expressionWeights,
      expressionTargetWeights: request.expressionTargetWeights,
    })

    return {
      status: 'started',
      reason_code: 'motion_runtime_expression_frame_queued',
      runtime_result_id:
        request.trace.runtime_result_id ?? request.trace.driver_result_id,
      safe_visible_state: 'expression_change_requested',
    }
  }

  public unloadVRM(): void {
    if (this.model?.vrm) {
      this.model.stopMotionRuntimeGroup('dance.sequence')
      this._scene.remove(this.model.vrm.scene)
      this.model?.unLoadVrm()
    }
  }

  /**
   * Reactで管理しているCanvasを後から設定する
   */
  public setup(canvas: HTMLCanvasElement) {
    const parentElement = canvas.parentElement
    const width = parentElement?.clientWidth || canvas.width
    const height = parentElement?.clientHeight || canvas.height
    // renderer
    this._renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
    })
    this._renderer.setSize(width, height)
    this._renderer.setPixelRatio(window.devicePixelRatio)

    // camera
    this._camera = new THREE.PerspectiveCamera(20.0, width / height, 0.1, 20.0)
    this._camera.position.set(0, 1.3, 1.5)
    this._cameraControls?.target.set(0, 1.3, 0)
    this._cameraControls?.update()
    // camera controls
    this._cameraControls = new OrbitControls(
      this._camera,
      this._renderer.domElement
    )
    this._cameraControls.screenSpacePanning = true
    this._cameraControls.update()

    // Listen for position lock changes
    this._cameraControls.addEventListener('end', () => {
      if (!settingsStore.getState().fixedCharacterPosition) {
        this.saveCameraPosition()
      }
    })

    window.addEventListener('resize', () => {
      this.resize()
    })
    this.isReady = true
    this.update()

    // Restore saved position if available
    this.restoreCameraPosition()

    this._settingsUnsubscribe?.()
    this._settingsUnsubscribe = settingsStore.subscribe((state, previous) => {
      if (state.lightingIntensity !== previous.lightingIntensity) {
        this.updateLightingIntensity(state.lightingIntensity)
      }
      if (
        state.fixedCharacterPosition !== previous.fixedCharacterPosition ||
        state.characterPosition !== previous.characterPosition ||
        state.characterRotation !== previous.characterRotation
      ) {
        this.restoreCameraPosition()
      }
    })
  }

  /**
   * canvasの親要素を参照してサイズを変更する
   */
  public resize() {
    if (!this._renderer) return

    const parentElement = this._renderer.domElement.parentElement
    if (!parentElement) return

    this._renderer.setPixelRatio(window.devicePixelRatio)
    this._renderer.setSize(
      parentElement.clientWidth,
      parentElement.clientHeight
    )

    if (!this._camera) return
    this._camera.aspect = parentElement.clientWidth / parentElement.clientHeight
    this._camera.updateProjectionMatrix()
  }

  /**
   * VRMのheadノードを参照してカメラ位置を調整する
   */
  public resetCamera() {
    const { fixedCharacterPosition } = settingsStore.getState()
    // If position is fixed, restore saved position instead of auto-adjusting
    if (fixedCharacterPosition) {
      this.restoreCameraPosition()
      return
    }

    const headNode = this.model?.vrm?.humanoid.getNormalizedBoneNode('head')

    if (headNode) {
      const headWPos = headNode.getWorldPosition(new THREE.Vector3())
      this._camera?.position.set(
        this._camera.position.x,
        headWPos.y,
        this._camera.position.z
      )
      this._cameraControls?.target.set(headWPos.x, headWPos.y, headWPos.z)
      this._cameraControls?.update()
    }
  }

  public update = () => {
    requestAnimationFrame(this.update)
    const delta = this._clock.getDelta()
    // update vrm components
    if (this.model) {
      this.model.update(delta)
      this.model.finalizeMotionDriverResult()
      this.publishMotionRuntimeDebugSnapshot()
    }

    if (this._renderer && this._camera) {
      this._renderer.render(this._scene, this._camera)
    }
  }

  /**
   * 現在のカメラ位置を設定に保存する
   */
  public saveCameraPosition() {
    if (!this._camera || !this._cameraControls) return

    const settings = settingsStore.getState()
    settingsStore.setState({
      characterPosition: {
        x: this._camera.position.x,
        y: this._camera.position.y,
        z: this._camera.position.z,
        scale: settings.characterPosition?.scale ?? 1,
      },
      characterRotation: {
        x: this._cameraControls.target.x,
        y: this._cameraControls.target.y,
        z: this._cameraControls.target.z,
      },
    })
  }

  /**
   * 保存されたカメラ位置を復元する
   */
  public restoreCameraPosition() {
    if (!this._camera || !this._cameraControls) return

    const { characterPosition, characterRotation, fixedCharacterPosition } =
      settingsStore.getState()

    if (
      fixedCharacterPosition &&
      (characterPosition.x !== 0 ||
        characterPosition.y !== 0 ||
        characterPosition.z !== 0)
    ) {
      this._camera.position.set(
        characterPosition.x,
        characterPosition.y,
        characterPosition.z
      )
      this._cameraControls.target.set(
        characterRotation.x,
        characterRotation.y,
        characterRotation.z
      )
      this._cameraControls.update()
    }
  }

  /**
   * カメラ位置を固定する
   */
  public fixCameraPosition() {
    this.saveCameraPosition()
    settingsStore.setState({ fixedCharacterPosition: true })
    if (this._cameraControls) {
      this._cameraControls.enabled = false
    }
  }

  /**
   * カメラ位置の固定を解除する
   */
  public unfixCameraPosition() {
    settingsStore.setState({ fixedCharacterPosition: false })
    if (this._cameraControls) {
      this._cameraControls.enabled = true
    }
  }

  /**
   * カメラ位置をリセットする
   */
  public resetCameraPosition() {
    settingsStore.setState({
      fixedCharacterPosition: false,
      characterPosition: { x: 0, y: 0, z: 0, scale: 1 },
      characterRotation: { x: 0, y: 0, z: 0 },
    })
    if (this._cameraControls) {
      this._cameraControls.enabled = true
    }
    this.resetCamera()
  }

  /**
   * ライトの強度を更新する
   */
  public updateLightingIntensity(intensity: number) {
    if (this._directionalLight) {
      this._directionalLight.intensity = 1.8 * intensity
    }
    if (this._ambientLight) {
      this._ambientLight.intensity = 1.2 * intensity
    }
  }

  private publishMotionRuntimeDebugSnapshot(): void {
    if (typeof window === 'undefined' || !this.model) return
    const debugSnapshot = this.model.getMotionRuntimeDebugSnapshot()
    const frameTimestampMonoMs = readProjectionVisualMonoTimestampMs()
    const projectionWindow = window as typeof window & {
      __projectionVisualMotionRuntimeDebugSnapshot?: MotionRuntimeDebugSnapshot
      __projectionVisualMotionStimulusResult?: MotionStimulusReceiverResult
      __projectionVisualInPageDiagnosticsV0?: ProjectionVisualInPageDiagnosticsV0
    }

    projectionWindow.__projectionVisualMotionRuntimeDebugSnapshot =
      debugSnapshot
    projectionWindow.__projectionVisualInPageDiagnosticsV0 =
      createProjectionVisualInPageDiagnostics({
        visualSessionId: this._visualSessionId,
        projectionVisualInstanceId: this._projectionVisualInstanceId,
        surfaceInstanceId: this._avatarCanvasSurfaceInstanceId,
        frameTimestampMonoMs,
        motionRuntimeDebugSnapshot: debugSnapshot,
        motionStimulusResult:
          projectionWindow.__projectionVisualMotionStimulusResult ?? null,
      })
  }
}

export function createProjectionVisualInPageDiagnostics(args: {
  visualSessionId: string
  projectionVisualInstanceId: string
  surfaceInstanceId: string
  frameTimestampMonoMs: number
  motionRuntimeDebugSnapshot: MotionRuntimeDebugSnapshot
  motionStimulusResult?: MotionStimulusReceiverResult | null
}): ProjectionVisualInPageDiagnosticsV0 {
  const runtimeResult = args.motionStimulusResult ?? null
  const driverResult = args.motionRuntimeDebugSnapshot.driverResult
  const expressionSummary =
    args.motionRuntimeDebugSnapshot.expressionValueSummary

  return {
    schema_version: PROJECTION_VISUAL_IN_PAGE_DIAGNOSTICS_SCHEMA_VERSION,
    visual_session_id: args.visualSessionId,
    projection_visual_instance_id: args.projectionVisualInstanceId,
    surface_class: 'avatar_webgl_canvas',
    surface_instance_id: args.surfaceInstanceId,
    roi_registry_version: PROJECTION_VISUAL_ROI_REGISTRY_VERSION,
    frame_seq: args.motionRuntimeDebugSnapshot.frameSeq,
    frame_timestamp_mono_ms: args.frameTimestampMonoMs,
    visual_heartbeat: {
      status: 'fresh',
      frame_seq: args.motionRuntimeDebugSnapshot.frameSeq,
      frame_timestamp_mono_ms: args.frameTimestampMonoMs,
      freshness_age_ms: 0,
    },
    runtime_refs: {
      motion_event_id: runtimeResult?.motion_event_id ?? null,
      stimulus_id: runtimeResult?.stimulus_id ?? null,
      stimulus_instance_id: runtimeResult?.stimulus_instance_id ?? null,
      runtime_result_id: runtimeResult?.runtime_result_id ?? null,
      driver_result_id:
        runtimeResult?.driver_result_id ??
        expressionSummary.last_driver_result_id,
      multi_stimulus_group_id: runtimeResult?.multi_stimulus_group_id ?? null,
      accepted: runtimeResult?.accepted ?? null,
      status: runtimeResult?.status ?? null,
      reason_code: runtimeResult?.reason_code ?? null,
      safe_visible_state: runtimeResult?.safe_visible_state ?? null,
    },
    runtime_anchors: createRuntimeLifecycleAnchors(runtimeResult),
    driver_frame_anchor: {
      frame_seq:
        expressionSummary.last_frame_seq ??
        args.motionRuntimeDebugSnapshot.frameSeq,
      frame_timestamp_mono_ms: args.frameTimestampMonoMs,
      driver_result_id:
        driverResult?.driver_result_id ??
        expressionSummary.last_driver_result_id,
      observed_at:
        driverResult?.observed_at ?? expressionSummary.last_observed_at,
      reason_code:
        driverResult?.reason_code ?? expressionSummary.last_driver_reason_code,
      safe_visible_state:
        driverResult?.safe_visible_state ??
        expressionSummary.last_safe_visible_state,
    },
    expression_value_summary: {
      ...expressionSummary,
      channel_names: [...expressionSummary.channel_names],
    },
    mixed_surface_separation: {
      avatar_canvas_surface_class: 'avatar_webgl_canvas',
      dom_overlay_surface_classes: [
        'hud_dom_overlay',
        'speech_bubble_dom_overlay',
      ],
      dom_overlay_is_not_avatar_canvas_proof: true,
      avatar_canvas_is_not_dom_overlay_proof: true,
    },
  }
}

function createRuntimeLifecycleAnchors(
  runtimeResult: MotionStimulusReceiverResult | null
): ProjectionVisualInPageDiagnosticsV0['runtime_anchors'] {
  const anchors: ProjectionVisualInPageDiagnosticsV0['runtime_anchors'] = {}
  for (const entry of runtimeResult?.lifecycle_trace ?? []) {
    anchors[entry.state] = {
      status: entry.status,
      reason_code: entry.reason_code,
      at_ms: entry.at_ms,
    }
  }
  return anchors
}

function createProjectionVisualDiagnosticsId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

function readProjectionVisualMonoTimestampMs(): number {
  const timestamp =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()
  return Math.round(timestamp * 1000) / 1000
}
