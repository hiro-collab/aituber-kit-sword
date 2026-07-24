export const FIRE_P027_SLOT_COUNT = 150
export const FIRE_P027_SLICE_SIZE = 50
export const FIRE_P027_LAYER_COUNT = 120
export const FIRE_P027_FIXED_DT_SECONDS = 1 / 60

export const FIRE_P027_STATE_PORTS = Object.freeze([
  'STATE_POSITION_AGE',
  'STATE_GENERATION_LIFE',
  'STATE_VELOCITY_OPACITY',
  'STATE_CONTROL_RELAY',
] as const)

export interface FireP027Controls {
  birthPerSecond: number
  lifeSeconds: number
  spriteWidthCssPx: number
  spriteHeightCssPx: number
  resolutionScale: number
  inputLagSeconds: number
  originSeed: number
  originRadiusX: number
  originRadiusY: number
  originRadiusZ: number
  originCenterX: number
  originCenterY: number
  originCenterZ: number
  forceX: number
  forceY: number
  forceZ: number
  windX: number
  windY: number
  windZ: number
  turbulenceX: number
  turbulenceY: number
  turbulenceZ: number
  turbulencePeriod: number
  particleSeed: number
  lifeVarianceSeconds: number
  jitterBirths: boolean
  useMass: boolean
  mass: number
  useDrag: boolean
  drag: number
  alphaSpeed: number
  tintR: number
  tintG: number
  tintB: number
  tintA: number
}

export const FIRE_P027_DEFAULT_CONTROLS: Readonly<FireP027Controls> =
  Object.freeze({
    birthPerSecond: 300,
    lifeSeconds: 0.5,
    spriteWidthCssPx: 96,
    spriteHeightCssPx: 96,
    resolutionScale: 0.75,
    inputLagSeconds: 0.1,
    originSeed: 0,
    originRadiusX: 0.1,
    originRadiusY: 0.1,
    originRadiusZ: 0.1,
    originCenterX: 0,
    originCenterY: 0,
    originCenterZ: 0,
    forceX: 0,
    forceY: 4,
    forceZ: 0,
    windX: 0,
    windY: 3,
    windZ: 0,
    turbulenceX: 6,
    turbulenceY: 6,
    turbulenceZ: 6,
    turbulencePeriod: 0.01,
    particleSeed: 1,
    lifeVarianceSeconds: 0,
    jitterBirths: false,
    useMass: false,
    mass: 1,
    useDrag: false,
    drag: 1,
    alphaSpeed: 0,
    tintR: 1,
    tintG: 1,
    tintB: 1,
    tintA: 1,
  })

export interface FireP027SpawnBatch {
  start: number
  count: number
  generationBase: number
  logicalUpdate: number
  dtSeconds: number
}

export interface FireP027OriginPoint {
  x: number
  y: number
  z: number
}

export interface FireP027SurfaceAudit {
  aliveCount: number
  disposed: boolean
  drawCount: number
  glError: number
  laggedGate: number
  outputHeight: number
  outputWidth: number
  rawGate: number
  resourceCount: number
  snapshotCaptured: number
  snapshotComplete: boolean
  stateSteps: number
}

/** GPU-state boundary. Texture units, MRT indices and RAF ownership stay private. */
export interface FireP027Surface {
  step(
    batch: Readonly<FireP027SpawnBatch>,
    rawGate: number,
    controls: Readonly<FireP027Controls>
  ): void
  draw(controls: Readonly<FireP027Controls>): void
  setOrigins(points: readonly Readonly<FireP027OriginPoint>[]): void
  reset(): void
  clear(): void
  dispose(): void
  audit?(): Readonly<FireP027SurfaceAudit>
}

export interface FireP027CapabilitySnapshot {
  colorBufferFloat: boolean
  floatBlend: boolean
  maxArrayTextureLayers: number
  maxColorAttachments: number
  maxDrawBuffers: number
  webgl2: boolean
}

export type FireP027CapabilityFailure =
  | 'webgl2'
  | 'color-buffer-float'
  | 'float-blend'
  | 'draw-buffers'
  | 'color-attachments'
  | 'array-layers'

export class FireP027CapabilityError extends Error {
  readonly code = 'fire-p027-capability-unavailable'

  constructor(readonly failure: FireP027CapabilityFailure) {
    super(`P027 fire capability unavailable: ${failure}`)
    this.name = 'FireP027CapabilityError'
  }
}

export function assertFireP027Capabilities(
  capabilities: Readonly<FireP027CapabilitySnapshot>
): void {
  if (!capabilities.webgl2) throw new FireP027CapabilityError('webgl2')
  if (!capabilities.colorBufferFloat) {
    throw new FireP027CapabilityError('color-buffer-float')
  }
  if (!capabilities.floatBlend) {
    throw new FireP027CapabilityError('float-blend')
  }
  if (capabilities.maxDrawBuffers < FIRE_P027_STATE_PORTS.length) {
    throw new FireP027CapabilityError('draw-buffers')
  }
  if (capabilities.maxColorAttachments < FIRE_P027_STATE_PORTS.length) {
    throw new FireP027CapabilityError('color-attachments')
  }
  if (capabilities.maxArrayTextureLayers < FIRE_P027_LAYER_COUNT) {
    throw new FireP027CapabilityError('array-layers')
  }
}

export function cloneFireP027Defaults(): FireP027Controls {
  return { ...FIRE_P027_DEFAULT_CONTROLS }
}
