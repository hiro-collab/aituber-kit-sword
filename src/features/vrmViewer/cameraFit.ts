export type CameraFitBounds = {
  min: { x: number; y: number; z: number }
  max: { x: number; y: number; z: number }
}

export type CameraFit = {
  target: { x: number; y: number; z: number }
  position: { x: number; y: number; z: number }
  near: number
  far: number
}

const MIN_MODEL_SPAN = 1e-5

const isFinitePoint = (point: CameraFitBounds['min']) =>
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  Number.isFinite(point.z)

const areFiniteNumbers = (...values: number[]) =>
  values.every((value) => Number.isFinite(value))

export const calculateCameraFit = (
  bounds: CameraFitBounds,
  verticalFovDegrees: number,
  aspect: number,
  padding = 1.15
): CameraFit | null => {
  if (
    !isFinitePoint(bounds.min) ||
    !isFinitePoint(bounds.max) ||
    !Number.isFinite(verticalFovDegrees) ||
    verticalFovDegrees <= 0 ||
    verticalFovDegrees >= 180 ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    !Number.isFinite(padding) ||
    padding < 1
  ) {
    return null
  }

  const width = bounds.max.x - bounds.min.x
  const height = bounds.max.y - bounds.min.y
  const depth = Math.max(0, bounds.max.z - bounds.min.z)
  if (
    !areFiniteNumbers(width, height, depth) ||
    width < MIN_MODEL_SPAN ||
    height < MIN_MODEL_SPAN
  ) {
    return null
  }

  const verticalHalfFov = (verticalFovDegrees * Math.PI) / 360
  const verticalTangent = Math.tan(verticalHalfFov)
  const horizontalHalfFov = Math.atan(verticalTangent * aspect)
  const horizontalTangent = Math.tan(horizontalHalfFov)
  if (
    !areFiniteNumbers(
      verticalHalfFov,
      verticalTangent,
      horizontalHalfFov,
      horizontalTangent
    ) ||
    verticalTangent <= 0 ||
    horizontalTangent <= 0
  ) {
    return null
  }

  const heightDistance = height / 2 / verticalTangent
  const widthDistance = width / 2 / horizontalTangent
  const frontClearance = Math.max(heightDistance, widthDistance) * padding
  const target = {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2,
  }
  const cameraZ = bounds.max.z + frontClearance
  const visibleDepth = frontClearance + depth
  const near = Math.max(0.01, frontClearance * 0.01)
  const far = Math.max(20, visibleDepth * 2)

  if (
    !areFiniteNumbers(
      heightDistance,
      widthDistance,
      frontClearance,
      target.x,
      target.y,
      target.z,
      cameraZ,
      visibleDepth,
      near,
      far
    ) ||
    near <= 0 ||
    far <= near
  ) {
    return null
  }

  return {
    target,
    position: { x: target.x, y: target.y, z: cameraZ },
    near,
    far,
  }
}
