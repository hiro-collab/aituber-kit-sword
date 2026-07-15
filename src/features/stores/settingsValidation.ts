export const CAMERA_HORIZONTAL_FOV_MIN = 20
export const CAMERA_HORIZONTAL_FOV_MAX = 90
export const CAMERA_HORIZONTAL_FOV_DEFAULT = 35

export const LIGHTING_INTENSITY_MIN = 0.1
export const LIGHTING_INTENSITY_MAX = 3
export const LIGHTING_INTENSITY_DEFAULT = 1

export const isCameraHorizontalFov = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= CAMERA_HORIZONTAL_FOV_MIN &&
  value <= CAMERA_HORIZONTAL_FOV_MAX

export const isLightingIntensity = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= LIGHTING_INTENSITY_MIN &&
  value <= LIGHTING_INTENSITY_MAX
