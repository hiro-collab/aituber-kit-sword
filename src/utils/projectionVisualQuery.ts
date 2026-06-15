import {
  resolveProjectionVisualStimulusRef,
  type ProjectionVisualStimulusRef,
} from '@/features/motionRuntime/projectionVisualStimulusTransport'

type QueryValue = string | string[] | undefined
export type ProjectionVisualMode = 'operator' | 'passive' | 'stage-output'
export type ProjectionVisualTestMode = 'idle-neutral' | 'self-mirror-baseline'

export const HIDDEN_HUD_QUERY_VALUES = new Set([
  '0',
  'false',
  'off',
  'hidden',
  'none',
])

export function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function readProjectionVisualQueryFromPath(asPath: string): {
  mode?: string
  hud?: string
  visualTest?: string
  motionAsset?: string
  stimulusRef?: string
  motionStimulusRef?: string
} {
  const queryText = asPath.split('?')[1]?.split('#')[0] ?? ''
  const params = new URLSearchParams(queryText)
  return {
    mode: params.get('mode') ?? undefined,
    hud: params.get('hud') ?? undefined,
    visualTest: params.get('visualTest') ?? undefined,
    motionAsset: params.get('motionAsset') ?? undefined,
    stimulusRef: params.get('stimulusRef') ?? undefined,
    motionStimulusRef: params.get('motionStimulusRef') ?? undefined,
  }
}

export function resolveProjectionVisualQueryState(query: {
  mode?: QueryValue
  hud?: QueryValue
  visualTest?: QueryValue
  motionAsset?: QueryValue
  stimulusRef?: QueryValue
  motionStimulusRef?: QueryValue
}) {
  const modeQuery = firstQueryValue(query.mode)
  const hudQuery = firstQueryValue(query.hud)?.toLowerCase()
  const visualTestQuery = firstQueryValue(query.visualTest)?.toLowerCase()
  const motionAssetQuery = firstQueryValue(query.motionAsset)
  const stimulusRefQuery =
    firstQueryValue(query.motionStimulusRef) ??
    firstQueryValue(query.stimulusRef)
  const isPassiveMode = modeQuery === 'passive'
  const isStageOutputMode =
    modeQuery === 'stage-output' || modeQuery === 'stage'
  const isDisplayOnlyMode = isPassiveMode || isStageOutputMode
  const projectionVisualMode: ProjectionVisualMode = isPassiveMode
    ? 'passive'
    : isStageOutputMode
      ? 'stage-output'
      : 'operator'
  const shouldReceiveDisplayState = isDisplayOnlyMode
  const projectionVisualTestMode: ProjectionVisualTestMode | undefined =
    visualTestQuery === 'idle-neutral' ||
    visualTestQuery === 'self-mirror-baseline'
      ? visualTestQuery
      : undefined
  const isIdleNeutralVisualTestMode =
    projectionVisualTestMode === 'idle-neutral'
  const isSelfMirrorBaselineVisualTestMode =
    projectionVisualTestMode === 'self-mirror-baseline'
  const motionStimulusAssetPath =
    resolveSafePublicMotionAssetPath(motionAssetQuery)
  const projectionVisualStimulusRef: ProjectionVisualStimulusRef | undefined =
    resolveProjectionVisualStimulusRef(stimulusRefQuery)

  return {
    isPassiveMode,
    isStageOutputMode,
    isDisplayOnlyMode,
    projectionVisualMode,
    projectionVisualTestMode,
    isIdleNeutralVisualTestMode,
    isSelfMirrorBaselineVisualTestMode,
    motionStimulusAssetPath,
    projectionVisualStimulusRef,
    shouldReceiveDisplayState,
    shouldRenderHud: !hudQuery || !HIDDEN_HUD_QUERY_VALUES.has(hudQuery),
  }
}

export function resolveSafePublicMotionAssetPath(
  path?: string
): string | undefined {
  const trimmed = path?.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('//')) return undefined
  if (!trimmed.startsWith('/local-vrma/')) return undefined
  if (trimmed.includes('..')) return undefined
  if (trimmed.includes('\\')) return undefined
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return undefined
  if (!/^\/local-vrma\/[a-z0-9_-][a-z0-9._-]*\.vrma$/i.test(trimmed)) {
    return undefined
  }
  return trimmed
}
