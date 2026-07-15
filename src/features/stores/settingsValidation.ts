export const CAMERA_HORIZONTAL_FOV_MIN = 20
export const CAMERA_HORIZONTAL_FOV_MAX = 90
export const CAMERA_HORIZONTAL_FOV_DEFAULT = 35

export const isCameraHorizontalFov = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= CAMERA_HORIZONTAL_FOV_MIN &&
  value <= CAMERA_HORIZONTAL_FOV_MAX
