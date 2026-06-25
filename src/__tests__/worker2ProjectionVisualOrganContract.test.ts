/**
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'
import {
  readProjectionVisualQueryFromPath,
  resolveSafePublicMotionAssetPath,
  resolveProjectionVisualQueryState,
} from '@/utils/projectionVisualQuery'
import {
  createProjectionVisualMotionStimulusFromRef,
  resolveProjectionVisualStimulusRef,
} from '@/features/motionRuntime/projectionVisualStimulusTransport'
import {
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE,
  PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION,
} from '@/features/motionRuntime/projectionVisualControlledChromeObservation'

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

const readAgentOsSource = (relativePath: string) =>
  fs.readFileSync(
    path.join(process.cwd(), '..', '..', '..', relativePath),
    'utf8'
  )

describe('worker-2 projection visual organ contract', () => {
  it('keeps Projection Visual routed through configured system-cell AI service', () => {
    const source = readSource('src/pages/index.tsx')

    expect(source).toContain('NEXT_PUBLIC_SYSTEM_CELL_AI_SERVICE')
    expect(source).toContain('NEXT_PUBLIC_SELECT_AI_SERVICE')
    expect(source).toContain("configured === 'thought-core'")
    expect(source).toContain('selectAIService: configuredSystemCellAIService')
    expect(source).toContain('thoughtCoreUrl: configuredThoughtCoreUrl')
    expect(source).not.toContain('NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE')
    expect(source).not.toContain("configured === 'dify'")
  })

  it('keeps Projection Visual display-only modes scoped through query mode', () => {
    const source = readSource('src/pages/projection-visual.tsx')
    const querySource = readSource('src/utils/projectionVisualQuery.ts')
    const stimulusBridgeSource = readSource(
      'src/features/motionRuntime/projectionVisualStimulusRefBridge.tsx'
    )
    const stimulusTransportSource = readSource(
      'src/features/motionRuntime/projectionVisualStimulusTransport.ts'
    )
    const controlledChromeObservationSource = readSource(
      'src/features/motionRuntime/projectionVisualControlledChromeObservation.ts'
    )

    expect(source).toContain('resolveProjectionVisualQueryState(routeQuery)')
    expect(source).toContain('router.isReady')
    expect(source).toContain('readProjectionVisualQueryFromPath(router.asPath)')
    expect(querySource).toContain('HIDDEN_HUD_QUERY_VALUES')
    expect(querySource).toContain('readProjectionVisualQueryFromPath')
    expect(querySource).toContain('resolveSafePublicMotionAssetPath')
    expect(querySource).toContain('resolveProjectionVisualStimulusRef')
    expect(querySource).toContain("visualTestQuery === 'idle-neutral'")
    expect(querySource).toContain("visualTestQuery === 'self-mirror-baseline'")
    expect(querySource).toContain("modeQuery === 'stage-output'")
    expect(querySource).toContain(
      'const isDisplayOnlyMode = isPassiveMode || isStageOutputMode'
    )
    expect(querySource).toContain(
      'const shouldReceiveDisplayState = isDisplayOnlyMode'
    )
    expect(querySource).toContain(
      "ProjectionVisualTestMode = 'idle-neutral' | 'self-mirror-baseline'"
    )
    expect(source).toContain(
      'data-projection-visual-mode={projectionVisualMode}'
    )
    expect(source).toContain(
      "data-projection-visual-test-mode={projectionVisualTestMode ?? 'none'}"
    )
    expect(source).toContain(
      'motionStimulusAssetPath={motionStimulusAssetPath}'
    )
    expect(source).toContain('ProjectionVisualStimulusRefBridge')
    expect(source).toContain('data-projection-visual-stimulus-ref={')
    expect(source).toContain("projectionVisualStimulusRef ?? 'none'")
    expect(stimulusBridgeSource).toContain(
      'publishRuntimeSummaryDomAttributes(state)'
    )
    expect(stimulusBridgeSource).toContain(
      'PROJECTION_VISUAL_RUNTIME_DOM_SUMMARY_ATTRIBUTE_NAMES'
    )
    expect(stimulusTransportSource).toContain(
      'data-projection-visual-runtime-summary-v0'
    )
    expect(stimulusTransportSource).toContain(
      'data-projection-visual-runtime-summary-provider-payload-published'
    )
    expect(controlledChromeObservationSource).toContain(
      'controlled_chrome_metric_summary'
    )
    expect(controlledChromeObservationSource).toContain('roi_window_metrics')
    expect(controlledChromeObservationSource).toContain(
      'raw_frame_included: false'
    )
    expect(stimulusBridgeSource).toContain(
      'ProjectionVisualControlledChromeObservationSession'
    )
    expect(stimulusBridgeSource).toContain(
      'publishProjectionVisualControlledChromeObservationDomSummary'
    )
    expect(source).toContain('enabled: !isDisplayOnlyMode')
    expect(source).toContain(
      "variant={isDisplayOnlyMode ? 'passive' : 'operator'}"
    )
    expect(source).toContain(
      'const displayStateBridgeMode = shouldReceiveDisplayState'
    )
    expect(source).toContain('isStageOutputMode')
    expect(source).toContain("? 'stage-output'")
    expect(source).toContain("? 'passive'")
    expect(source).toContain('<ProjectionVisualDisplayStateBridge')
    expect(source).toContain('mode={displayStateBridgeMode}')
    expect(source).toContain('{!isDisplayOnlyMode && <ModalImage />}')
    expect(source).toContain('{!isDisplayOnlyMode && <Toasts />}')
    expect(source).toContain('{!isDisplayOnlyMode && <CharacterPresetMenu />}')
    expect(source).toContain('{!isDisplayOnlyMode && <ImageOverlay />}')
    expect(source).toContain('{!isDisplayOnlyMode && <KioskOverlay />}')
    expect(source).toContain(
      '!isDisplayOnlyMode && controlOwner.isOwner && messageReceiverEnabled'
    )
    expect(source).toContain('!isDisplayOnlyMode && controlOwner.isOwner &&')
    expect(source).toContain('<GestureVoiceBridge />')
  })

  it('does not mix legacy Projection Visual Dify force flags into current AI service routing', () => {
    const source = readSource('src/pages/projection-visual.tsx')

    expect(source).toContain('NEXT_PUBLIC_PROJECTION_VISUAL_AI_SERVICE')
    expect(source).toContain("configured === 'thought-core'")
    expect(source).not.toContain("configured === 'dify'")
    expect(source).not.toContain('NEXT_PUBLIC_PROJECTION_VISUAL_FORCE_DIFY')
    expect(source).not.toContain('legacyForceDify')
  })

  it.each([
    [
      'passive default hud',
      { mode: 'passive' },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      undefined,
      false,
      true,
      true,
    ],
    [
      'passive hidden hud',
      { mode: 'passive', hud: 'off' },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      undefined,
      false,
      true,
      false,
    ],
    [
      'passive hidden hud array',
      { mode: ['passive'], hud: ['0'] },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      undefined,
      false,
      true,
      false,
    ],
    [
      'stage-output default hud',
      { mode: 'stage-output' },
      false,
      true,
      true,
      'stage-output',
      undefined,
      undefined,
      undefined,
      false,
      true,
      true,
    ],
    [
      'stage alias hidden hud',
      { mode: 'stage', hud: 'hidden' },
      false,
      true,
      true,
      'stage-output',
      undefined,
      undefined,
      undefined,
      false,
      true,
      false,
    ],
    [
      'operator default hud',
      {},
      false,
      false,
      false,
      'operator',
      undefined,
      undefined,
      undefined,
      false,
      false,
      true,
    ],
    [
      'operator idle-neutral visual test',
      { visualTest: 'idle-neutral' },
      false,
      false,
      false,
      'operator',
      'idle-neutral',
      undefined,
      undefined,
      true,
      false,
      true,
    ],
    [
      'passive idle-neutral visual test',
      { mode: 'passive', visualTest: 'idle-neutral' },
      true,
      false,
      true,
      'passive',
      'idle-neutral',
      undefined,
      undefined,
      true,
      true,
      true,
    ],
    [
      'passive self-mirror baseline visual test',
      { mode: 'passive', visualTest: 'self-mirror-baseline' },
      true,
      false,
      true,
      'passive',
      'self-mirror-baseline',
      undefined,
      undefined,
      false,
      true,
      true,
    ],
    [
      'unknown visual test ignored',
      { visualTest: 'unknown' },
      false,
      false,
      false,
      'operator',
      undefined,
      undefined,
      undefined,
      false,
      false,
      true,
    ],
    [
      'passive controlled chrome dance stimulus ref',
      { mode: 'passive', stimulusRef: 'voice.dance_please' },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      'voice.dance_please',
      false,
      true,
      true,
    ],
    [
      'passive controlled chrome dance stop stimulus ref',
      { mode: 'passive', stimulusRef: 'voice.stop_dance' },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      'voice.stop_dance',
      false,
      true,
      true,
    ],
    [
      'passive controlled chrome smile stimulus ref alias',
      { mode: 'passive', motionStimulusRef: 'voice.smile_please' },
      true,
      false,
      true,
      'passive',
      undefined,
      undefined,
      'voice.smile_please',
      false,
      true,
      true,
    ],
    [
      'operator hidden hud',
      { hud: 'hidden' },
      false,
      false,
      false,
      'operator',
      undefined,
      undefined,
      undefined,
      false,
      false,
      false,
    ],
    [
      'operator unknown hud value',
      { hud: 'visible' },
      false,
      false,
      false,
      'operator',
      undefined,
      undefined,
      undefined,
      false,
      false,
      true,
    ],
    [
      'unknown mode falls back to operator',
      { mode: 'unknown' },
      false,
      false,
      false,
      'operator',
      undefined,
      undefined,
      undefined,
      false,
      false,
      true,
    ],
  ])(
    'resolves Projection Visual query fuzz case: %s',
    (
      _label,
      query,
      isPassiveMode,
      isStageOutputMode,
      isDisplayOnlyMode,
      projectionVisualMode,
      projectionVisualTestMode,
      motionStimulusAssetPath,
      projectionVisualStimulusRef,
      isIdleNeutralVisualTestMode,
      shouldReceiveDisplayState,
      shouldRenderHud
    ) => {
      expect(resolveProjectionVisualQueryState(query)).toEqual({
        isPassiveMode,
        isStageOutputMode,
        isDisplayOnlyMode,
        projectionVisualMode,
        projectionVisualTestMode,
        motionStimulusAssetPath,
        projectionVisualStimulusRef,
        isIdleNeutralVisualTestMode,
        isSelfMirrorBaselineVisualTestMode:
          projectionVisualTestMode === 'self-mirror-baseline',
        shouldReceiveDisplayState,
        shouldRenderHud,
      })
    }
  )

  it.each([
    [
      '/projection-visual/?mode=passive',
      {
        mode: 'passive',
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?mode=passive&hud=0',
      {
        mode: 'passive',
        hud: '0',
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?mode=stage-output#display',
      {
        mode: 'stage-output',
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?visualTest=idle-neutral',
      {
        mode: undefined,
        hud: undefined,
        visualTest: 'idle-neutral',
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?visualTest=self-mirror-baseline',
      {
        mode: undefined,
        hud: undefined,
        visualTest: 'self-mirror-baseline',
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?motionAsset=/local-vrma/configured-dance.vrma',
      {
        mode: undefined,
        hud: undefined,
        visualTest: undefined,
        motionAsset: '/local-vrma/configured-dance.vrma',
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?stimulusRef=voice.dance_please',
      {
        mode: undefined,
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: 'voice.dance_please',
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?stimulusRef=voice.stop_dance',
      {
        mode: undefined,
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: 'voice.stop_dance',
        motionStimulusRef: undefined,
      },
    ],
    [
      '/projection-visual/?motionStimulusRef=voice.smile_please',
      {
        mode: undefined,
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: 'voice.smile_please',
      },
    ],
    [
      '/projection-visual/',
      {
        mode: undefined,
        hud: undefined,
        visualTest: undefined,
        motionAsset: undefined,
        stimulusRef: undefined,
        motionStimulusRef: undefined,
      },
    ],
  ])(
    'reads Projection Visual query from path before router query is ready: %s',
    (asPath, expectedQuery) => {
      expect(readProjectionVisualQueryFromPath(asPath)).toEqual(expectedQuery)
    }
  )

  it.each([
    [
      '/local-vrma/configured-dance.vrma',
      '/local-vrma/configured-dance.vrma',
    ],
    [' /local-vrma/trimmed.vrma ', '/local-vrma/trimmed.vrma'],
    ['/local-vrma/not-vrma.txt', undefined],
    ['/other-public/motion.vrma', undefined],
    ['local-vrma/relative.vrma', undefined],
    ['//example.test/file.vrma', undefined],
    ['/local-vrma/../secret.vrma', undefined],
    ['/local-vrma/subdir/file.vrma', undefined],
    ['/local-vrma/%2e%2e-secret.vrma', undefined],
    ['/local-vrma/file name.vrma', undefined],
    ['/local-vrma/.hidden.vrma', undefined],
    ['/local-vrma\\secret.vrma', undefined],
    ['https://example.test/motion.vrma', undefined],
    ['', undefined],
  ])('resolves safe public Motion Runtime asset path: %s', (path, expected) => {
    expect(resolveSafePublicMotionAssetPath(path)).toBe(expected)
  })

  it.each([
    ['voice.dance_please', 'voice.dance_please'],
    ['voice.stop_dance', 'voice.stop_dance'],
    ['voice.smile_please', 'voice.smile_please'],
    ['VOICE.DANCE_PLEASE', 'voice.dance_please'],
    ['raw_transcript', undefined],
    ['provider_payload', undefined],
    ['entity_id', undefined],
    ['https://example.test/stimulus', undefined],
  ])('resolves controlled-Chrome-safe stimulus ref: %s', (value, expected) => {
    expect(resolveProjectionVisualStimulusRef(value)).toBe(expected)
  })

  it('builds only safe controlled-Chrome Projection Visual stimulus payload shapes', () => {
    const dance = createProjectionVisualMotionStimulusFromRef(
      'voice.dance_please',
      new Date('2026-06-13T10:30:15.123Z')
    )
    const expression = createProjectionVisualMotionStimulusFromRef(
      'voice.smile_please',
      new Date('2026-06-13T10:30:15.123Z')
    )
    const stop = createProjectionVisualMotionStimulusFromRef(
      'voice.stop_dance',
      new Date('2026-06-13T10:30:15.123Z')
    )

    expect(dance).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'dance_sequence',
        request_mode: 'play',
        payload_ref: 'motion.thought_core.dance_sequence.v0',
        target_model_type: 'vrm',
      })
    )
    expect(expression).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'expression',
        request_mode: 'apply',
        payload_ref: 'motion.thought_core.expression_visible.v0',
        target_model_type: 'vrm',
      })
    )
    expect(stop).toEqual(
      expect.objectContaining({
        schema_version: 'motion_stimulus.v0',
        kind: 'stop',
        request_mode: 'stop',
        payload_ref: 'motion.thought_core.stop.v0',
        target_model_type: 'vrm',
        safe_visible_state: 'neutral_idle_requested',
      })
    )
    expect(JSON.stringify([dance, stop, expression])).not.toContain(
      'entity_id'
    )
    expect(JSON.stringify([dance, stop, expression])).not.toContain(
      'provider_payload'
    )
  })

  it('keeps controlled Chrome observation producer summary-only and DOM-readable', () => {
    expect(PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_ATTRIBUTE).toBe(
      'data-projection-visual-controlled-chrome-observation-v0'
    )
    expect(PROJECTION_VISUAL_CONTROLLED_CHROME_OBSERVATION_SCHEMA_VERSION).toBe(
      'self_mirror_controlled_chrome_observation.v0'
    )
  })

  it('keeps projection speech pagination and passive stage typography bounded', () => {
    const bubbleSource = readSource(
      'src/components/projectionVisualAssistantBubble.tsx'
    )
    const reviewProofMessageSource = readSource(
      'src/utils/reviewProofMessage.ts'
    )
    const speechParitySource = readSource(
      'src/utils/speechOutputParitySummary.ts'
    )
    const speakCharacterSource = readSource(
      'src/features/messages/speakCharacter.ts'
    )
    const bridgeSource = readSource(
      'src/components/projectionVisualDisplayStateBridge.tsx'
    )
    const cssSource = readSource('src/styles/globals.css')

    expect(bubbleSource).toContain('const MAX_OPERATOR_VISIBLE_LINES = 6')
    expect(bubbleSource).toContain('const MAX_PASSIVE_VISIBLE_LINES = 3')
    expect(bubbleSource).toContain(
      "import { compactReviewProofMessage } from '@/utils/reviewProofMessage'"
    )
    expect(reviewProofMessageSource).toContain(
      'export const compactReviewProofMessage'
    )
    expect(reviewProofMessageSource).toContain(
      'コマンドは送信済みです。実際に変わったかは未確認です。目視または別センサーで確認してください。'
    )
    expect(speechParitySource).toContain(
      'projection_visual_speech_output_parity.v0'
    )
    expect(speechParitySource).toContain(
      '__projectionVisualSpeechOutputSummaryV0'
    )
    expect(speechParitySource).toContain(
      '__projectionVisualSpeechOutputDisplayStateV0'
    )
    expect(speechParitySource).toContain('self_output_observation')
    expect(speechParitySource).toContain('may_start_user_turn: false')
    expect(speakCharacterSource).toContain(
      'writeSynthesizedSpeechOutputSummary'
    )
    expect(speakCharacterSource).toContain(
      'const speechOutputMessage = resolveSpeechOutputMessage(talk)'
    )
    expect(speakCharacterSource).toContain('message: speechOutputMessage')
    expect(speakCharacterSource).toContain(
      "'Talk.displayMessage.spoken'"
    )
    expect(
      speakCharacterSource.indexOf('writeSynthesizedSpeechOutputSummary(talk)')
    ).toBeLessThan(
      speakCharacterSource.indexOf(
        'buffer = await synthesizeVoice(talk, ss.selectVoice)'
      )
    )
    expect(bubbleSource).toContain('data-projection-visual-speech-parity-v0')
    expect(bubbleSource).toContain('data-speech-parity-status')
    expect(bubbleSource).toContain('data-speech-bubble-text-hash')
    expect(bubbleSource).toContain('data-speech-tts-text-hash')
    expect(bubbleSource).toContain('speechOutputDisplayState.display_message')
    expect(bubbleSource).toContain('message: currentPage')
    expect(bridgeSource).toContain('readWindowSpeechOutputDisplayState')
    expect(bubbleSource).toContain('(current + 1) % pages.length')
    expect(bubbleSource).toContain(
      "variant?: 'operator' | 'passive' | 'stage-output'"
    )
    expect(bubbleSource).toContain('passiveAssistantMessage')
    expect(bubbleSource).toContain("variant === 'stage-output'")
    expect(bubbleSource).toContain("variant === 'operator'")
    expect(cssSource).toContain(
      ".projection-visual[data-projection-visual-mode='passive']"
    )
    expect(cssSource).toContain(
      ".projection-visual[data-projection-visual-mode='stage-output']"
    )
    expect(cssSource).toContain('width: min(66vw, 960px)')
    expect(cssSource).toContain('font-size: clamp(28px, 2.25vw, 40px)')
    expect(cssSource).toContain('overflow-wrap: anywhere')
  })

  it('keeps normal HUD focused on Thought Core without legacy Dify display grouping', () => {
    const source = readSource('src/components/projectionVisualHud.tsx')

    expect(source).toContain(
      "touchdesigner_control_gui: 'display / projection'"
    )
    expect(source).not.toContain("dify: 'Dify compatibility'")
    expect(source).not.toContain('LEGACY_SERVICE_KEYS')
    expect(source).not.toContain('legacyServices')
    expect(source).not.toContain('td-services-legacy')
    expect(source).toContain('readDeveloperHudDiagnosticsFlag')
    expect(source).toContain("['debug', 'developer', 'hudDebug']")
    expect(source).toContain('const [developerHudDiagnostics]')
    expect(source).toContain("source === 'thought-core'")
    expect(source).toContain("source: 'thought-core'")
    expect(source).toContain('projection-visual-stt-status')
    expect(source).toContain('projection-visual-stt-diagnostic')
    expect(source).toContain('homeActionMode')
    expect(source).toContain('td-action-mode-strip')
    expect(source).toContain('接続状態のみ')
    expect(source).toContain('実送信なし')
    expect(source).toContain('DEMO')
    expect(source).toContain('デモ設定')
    expect(source).toContain('実家電送信')
    expect(source).toContain('const homeActionProofLabel')
    expect(source).toContain('CMD SENT / state未確認')
    expect(source).toContain('HA state proof')
    expect(source).toContain('external observed')
    expect(source).toContain('physical observed')
    expect(source).toContain('Display runtime bridge link')
    expect(source).toContain(
      'Expression runtime: face/speech path, not dance proof'
    )
    expect(source).toContain('data-bridge={homeActionBridgeState}')
    expect(readSource('src/styles/globals.css')).toContain(
      ".td-action-mode-strip[data-mode='live']"
    )
    expect(source).toContain('const MIN_HUD_FONT_SIZE = 8')
    expect(source).toContain('const DEFAULT_HUD_FONT_SIZE = 12')
    expect(source).toContain('const MAX_HUD_FONT_SIZE = 13')
    expect(readSource('src/styles/globals.css')).toContain(
      'font-size: clamp(8px, var(--td-font-size), 13px)'
    )
    expect(source).toContain('td-state-rail')
    expect(source).toContain('stateWordLabel')
    expect(source).toContain("return reportedStates.length > 0 ? aggregateState(reportedStates) : 'UNREPORTED'")
    expect(source).toContain("if (normalized === 'UNREPORTED') return '-'")
    expect(source).toContain('environmentRailWordLabel')
    expect(source).toContain('const environmentRailLabel')
    expect(source).toContain('{environmentRailLabel}')
    expect(source).toContain('environmentValueIndicators')
    expect(source).toContain('applianceIndicators')
    expect(source).not.toContain('actionReadinessIndicators')
    expect(source).not.toContain('Home action readiness:')
    expect(source).not.toContain('live_test_readiness')
    expect(source).not.toContain('environmentActionState')
    expect(source).toContain('stateQueryIndicators')
    expect(source).toContain('visionEstimateIndicators')
    expect(source).toContain("room_light: 'ROOM EST'")
    expect(source).toContain('elec cue ${electricLabel}')
    expect(source).toContain('VISION_SOURCE_ONLY_KEYS')
    expect(source).toContain('type HudUpdateSignal')
    expect(source).toContain('const HUD_UPDATE_TARGETS')
    expect(source).toContain(
      "'query:room_light': 'environment.roomLightEstimate'"
    )
    expect(source).toContain(
      "'vision:room_light': 'environment.roomLightEstimate'"
    )
    expect(source).toContain('Camera room-light estimate')
    expect(source).not.toContain('Vision estimate:')
    expect(source).toContain('buildEnvironmentHudUpdateSignal')
    expect(source).toContain('hudUpdateSemanticToken')
    expect(source).toContain('type EnvironmentFreshnessLevel')
    expect(source).toContain('type EnvironmentFreshnessVisual')
    expect(source).toContain('environmentFreshnessVisualLevel')
    expect(source).toContain('environmentFreshnessVisual')
    expect(source).toContain('readFreshnessAgeMs')
    expect(source).toContain('setInterval(() => setNowMs(Date.now()), 250)')
    expect(source).toContain('roomLightLiveMetrics')
    expect(source).toContain('roomLightEstimateProbabilityLabels')
    expect(source).toContain('td-env-live-meter')
    expect(source).toContain('data-metric={metric.id}')
    expect(source).toContain('electricLabel')
    expect(source).toContain('daylightLabel')
    expect(source).toContain(
      'data-update-signal={indicator.updateSignal?.target}'
    )
    expect(source).toContain('data-freshness={indicator.freshnessVisual.level}')
    expect(source).toContain('style={indicator.freshnessVisual.style}')
    expect(source).toContain('data-update-kind={indicator.updateSignal?.kind}')
    expect(source).toContain(
      'data-update-token={indicator.updateSignal?.token}'
    )
    expect(source).toContain('indicator.updateSignal?.token')
    expect(source).not.toContain(
      "token: [target, observedAt, snapshotId].filter(Boolean).join(':')"
    )
    expect(source).toContain('environmentSignalDetailLabel')
    expect(source).toContain('td-environment-values')
    expect(source).toContain('td-environment-source-strip')
    expect(source).toContain('td-sense-metric-grid')
    expect(source).toContain('td-runtime-mini-grid')
    expect(source).toContain("kicker=\"INPUT / TURN STATUS\"")
    expect(source).toContain('Current Step')
    expect(source).toContain('td-turn-stage-summary')
    expect(source).toContain("label: 'SENSE'")
    expect(source).toContain("label: 'CHECK'")
    expect(source).toContain("label: 'SEND'")
    expect(source).toContain("label: 'REPLY'")
    expect(source).toContain("label: 'CAM FPS'")
    expect(source).toContain("label: 'CAM FRESH'")
    expect(source).not.toContain('data-freshness-age')
    expect(source).not.toContain('ageLabel')
    expect(source).not.toContain('formatAge')
    expect(source).toContain("label: 'INPUT GATE'")
    expect(source).toContain("label: 'DISPLAY LINK'")
    expect(source).toContain("label: 'VOICE ENGINE'")
    expect(source).toContain("label: 'AVATAR VIEW'")
    expect(source).toContain("label: 'ROOM STATE'")
    expect(source).toContain('freshnessDetailLabel')
    expect(source).toContain('freshnessVisualFromAgeMs')
    expect(source).toContain('serviceFreshnessVisual')
    expect(source).toContain('normalRatio')
    expect(source).toContain('staleRatio')
    expect(source).toContain('data-freshness={tile.freshnessVisual?.level}')
    expect(source).toContain('style={tile.freshnessVisual?.style}')
    expect(source).toContain(
      'data-freshness={indicator.freshnessVisual?.level}'
    )
    expect(source).toContain("pipelineStage.includes('PREVIEW')")
    expect(readSource('src/styles/globals.css')).toContain('.td-state-rail')
    expect(readSource('src/styles/globals.css')).toContain('.td-env-value-card')
    expect(readSource('src/styles/globals.css')).toContain(
      ".td-cell-row[data-state='UNREPORTED'] .td-cell-dot"
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '@keyframes td-hud-update-pulse'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-env-value-card[data-update-signal]'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      ".td-env-value-card[data-freshness='live']"
    )
    expect(readSource('src/styles/globals.css')).toContain(
      ".td-source-chip[data-freshness='stale']"
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-sense-metric-tile[data-freshness]'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-stt-mini-card[data-freshness]'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-runtime-mini-card[data-freshness]'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '--td-freshness-hue'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      'transition:'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-env-live-meter'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-env-value-card .td-env-live-chip'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-sense-metric-tile'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-runtime-mini-card'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-turn-stage-summary'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      'grid-template-columns: repeat(4, minmax(0, 1fr))'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      'font-size: max(8px, 0.66em)'
    )
    expect(readSource('src/styles/globals.css')).toContain(
      '.td-render-controls-frame'
    )
    expect(source).toContain("variant = 'operator'")
    expect(source).toContain("const isPassiveHud = variant === 'passive'")
    expect(source).toContain(
      'const isHudVisible = isPassiveHud ? true : hud.visible'
    )
    expect(source).toContain('{!isPassiveHud && (')
    expect(source).toContain('{!isPassiveHud && !hud.visible && (')
    expect(source).toContain('if (isPassiveHud) {')
    expect(source).toContain('Conversation Log')
    expect(source).toContain('td-render-controls-frame')
    expect(source).toContain('if (isPassiveHud) return')
    expect(source).toContain('speechStatusTiles')
    expect(source).toContain("event.request_id || ''")
    expect(source).toContain('event.user_text || event.request_id')
  })

  it('keeps Thought Core API traces tied to projection-visual without trusting request URLs', () => {
    const source = readSource('src/pages/api/thoughtCoreChat.ts')

    expect(source).toContain('DEFAULT_THOUGHT_CORE_BASE_URL')
    expect(source).toContain('enforceLocalApiRequest')
    expect(source).toContain('validateThoughtCoreBaseUrl')
    expect(source).toContain("source: 'aituber-kit'")
    expect(source).toContain("route: 'projection-visual'")
    expect(source).toContain('THOUGHT_CORE_BASE_URL')
    expect(source).toContain('NEXT_PUBLIC_THOUGHT_CORE_BASE_URL')
  })

  it('keeps passive Projection Visual display-state sync local and bounded', () => {
    const bridgeSource = readSource(
      'src/components/projectionVisualDisplayStateBridge.tsx'
    )
    const apiSource = readSource('src/pages/api/projectionDisplayState.ts')
    const viewerSource = readSource('src/features/vrmViewer/viewer.ts')
    const modelSource = readSource('src/features/vrmViewer/model.ts')
    const vrmViewerSource = readSource('src/components/vrmViewer.tsx')
    const motionStimulusReceiverSource = readSource(
      'src/features/motionRuntime/motionStimulusReceiver.ts'
    )

    expect(bridgeSource).toContain(
      "mode: 'operator' | 'passive' | 'stage-output'"
    )
    expect(bridgeSource).toContain(
      "mode !== 'passive' && mode !== 'stage-output'"
    )
    expect(bridgeSource).toContain("fetch('/api/projectionDisplayState'")
    expect(bridgeSource).toContain('fixedCharacterPosition: true')
    expect(bridgeSource).toContain('viewer.restoreCameraPosition()')
    expect(apiSource).toContain('enforceLocalApiRequest')
    expect(apiSource).toContain("sizeLimit: '16kb'")
    expect(apiSource).toContain('MAX_ASSISTANT_MESSAGE_CHARS = 1600')
    expect(apiSource).toContain('readModelType')
    expect(apiSource).toContain('sequence: latestDisplayState.sequence + 1')
    expect(viewerSource).toContain('settingsStore.subscribe')
    expect(viewerSource).toContain('this.restoreCameraPosition()')
    expect(vrmViewerSource).toContain('loadedVrmPathRef')
    expect(vrmViewerSource).toContain('loadedVisualTestModeRef')
    expect(vrmViewerSource).toContain('useRef(frozenVisualTestMode)')
    expect(vrmViewerSource).toContain('selfMirrorBaselineVisualTestMode')
    expect(vrmViewerSource).toContain('__projectionVisualVrmViewerDebug')
    expect(vrmViewerSource).toContain('motion_stimulus_receiver_exception')
    expect(vrmViewerSource).toContain('.catch((error) =>')
    expect(vrmViewerSource).toContain(
      'idleNeutralVisualTestMode: frozenVisualTestMode'
    )
    expect(viewerSource).toContain('idleNeutralVisualTestMode')
    expect(viewerSource).toContain(
      "loadVRMAnimation(buildUrl('/idle_loop.vrma'))"
    )
    expect(viewerSource).toContain('if (!options.idleNeutralVisualTestMode)')
    expect(modelSource).toContain('freezeNonTargetVisualMotion')
    expect(modelSource).toContain('this.mixer?.stopAllAction()')
    expect(modelSource).toContain('getMotionRuntimeDebugSnapshot')
    expect(modelSource).toContain('vrmReady')
    expect(modelSource).toContain('sceneVisible')
    expect(viewerSource).toContain(
      '__projectionVisualMotionRuntimeDebugSnapshot'
    )
    expect(viewerSource).toContain('__projectionVisualInPageDiagnosticsV0')
    expect(viewerSource).toContain('projection_visual_in_page_diagnostics.v0')
    expect(viewerSource).toContain('projection_visual_roi_registry.v0')
    expect(viewerSource).toContain('mixed_surface_separation')
    expect(modelSource).toContain('expressionValueSummary')
    expect(modelSource).toContain('frame_applied_count')
    expect(modelSource).toContain(
      'this.vrm?.update(freezeNonTargetVisualMotion ? 0 : delta)'
    )
    expect(modelSource).toContain('motionRuntimeFrame')
    expect(modelSource).toContain('this._queuedMotionFrameSequence.shift()')
    expect(viewerSource).toContain('_motionRuntimeAssetLoadToken')
    expect(viewerSource).toContain('_loadedMotionRuntimeModel')
    expect(viewerSource).toContain('this.model !== model')
    expect(viewerSource).toContain(
      "this.model?.stopMotionRuntimeGroup('dance.sequence')"
    )
    expect(motionStimulusReceiverSource).toContain(
      'NEXT_PUBLIC_DANCE_MOTION_ASSET_PATH'
    )
    expect(motionStimulusReceiverSource).not.toContain(
      'DEFAULT_DANCE_MOTION_ASSET_PATH'
    )
    expect(motionStimulusReceiverSource).not.toContain('worker2-demo-dance')
    expect(motionStimulusReceiverSource).toContain(
      'dance_motion_asset_not_configured'
    )
    expect(viewerSource).toContain('Motion Runtime query VRMA unavailable')
    expect(viewerSource).toContain('Motion Runtime dance asset unavailable')
    expect(viewerSource).toContain('motion_asset_load_failed')
    expect(viewerSource).not.toContain(
      "Failed to load Motion Runtime VRMA:', error"
    )
    expect(viewerSource).not.toContain(
      "Failed to start Motion Runtime stimulus:', error"
    )
    expect(vrmViewerSource).toContain('motionStimulusAssetPathRef')
  })

  it('keeps Projection Visual VRM position controls out of the bottom input lane', () => {
    const controlsSource = readSource(
      'src/components/projectionVisualVrmPositionControls.tsx'
    )
    const stylesSource = readSource('src/styles/globals.css')

    expect(controlsSource).toContain('projection-visual-vrm-position-controls')
    expect(controlsSource).not.toContain('absolute bottom-4 left-4')
    expect(stylesSource).toContain('--projection-visual-input-bottom-safe')
    expect(stylesSource).toContain(
      '--projection-visual-render-controls-bottom-safe'
    )
    expect(stylesSource).toContain(
      '--projection-visual-vrm-position-controls-bottom'
    )
    expect(stylesSource).toContain(
      'bottom: var(--projection-visual-vrm-position-controls-bottom)'
    )
    expect(stylesSource).toContain('.projection-visual .td-message-input-shell')
  })

  it('keeps RR-001 review helpers on canonical trailing-slash projection routes', () => {
    const routeReadinessSource = readAgentOsSource(
      'scripts/check-ui-review-route-readiness.ps1'
    )
    const captureSource = readAgentOsSource(
      'scripts/capture-ui-review-screenshots.mjs'
    )

    expect(routeReadinessSource).toContain('/projection-visual/?mode=passive')
    expect(routeReadinessSource).toContain('route_label')
    expect(routeReadinessSource).toContain('known-gap')
    expect(captureSource).toContain('/projection-visual/?mode=passive')
    expect(captureSource).toContain('route_label')
    expect(captureSource).toContain('known-gap')
  })
})
