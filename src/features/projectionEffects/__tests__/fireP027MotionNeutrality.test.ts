import { mapFireParametersToP027Controls } from '../plugins/fire/p027/renderer'
import {
  applyFireP027EmitterMotion,
  sampleFireP027LocalTurbulence,
  type FireP027VectorSample,
} from '../plugins/fire/p027/shaders'
import { generateFireP027FallbackOrigins } from '../plugins/fire/p027/webglEngine'

describe('P027 Fire motion neutrality', () => {
  it('keeps position, horizontal motion, and bounded seed domains independent', () => {
    const left = mapFireParametersToP027Controls({
      emitterX: -0.8,
      emitterY: 0.4,
      seed: 9317,
    })
    const right = mapFireParametersToP027Controls({
      emitterX: 0.8,
      emitterY: -0.4,
      seed: 9317,
    })

    expect(left.originCenterX).not.toBe(right.originCenterX)
    expect(left.originCenterY).not.toBe(right.originCenterY)
    expect(left.forceX).toBe(0)
    expect(left.windX).toBe(0)
    expect(right.forceX).toBe(0)
    expect(right.windX).toBe(0)
    expect(right.originSeed).toBe(left.originSeed)
    expect(right.particleSeed).toBe(left.particleSeed)
    expect(Number.isInteger(left.particleSeed)).toBe(true)
    expect(left.particleSeed).toBeGreaterThanOrEqual(0)
    expect(left.particleSeed).toBeLessThanOrEqual(10000)
  })

  it('translates origins without changing local shape or turbulence samples', () => {
    const first = mapFireParametersToP027Controls({
      emitterX: -0.6,
      emitterY: -0.2,
      seed: 74,
    })
    const translated = mapFireParametersToP027Controls({
      emitterX: 0.6,
      emitterY: 0.7,
      seed: 74,
    })
    const firstOrigins = generateFireP027FallbackOrigins(first)
    const translatedOrigins = generateFireP027FallbackOrigins(translated)

    firstOrigins.forEach((origin, index) => {
      const moved = translatedOrigins[index]!
      const local = subtract(origin, first)
      const movedLocal = subtract(moved, translated)
      expect(movedLocal.x).toBeCloseTo(local.x, 12)
      expect(movedLocal.y).toBeCloseTo(local.y, 12)
      expect(movedLocal.z).toBeCloseTo(local.z, 12)
      const movedSample = sampleFireP027LocalTurbulence(
        movedLocal,
        translated.turbulencePeriod,
        translated.particleSeed
      )
      const originalSample = sampleFireP027LocalTurbulence(
        local,
        first.turbulencePeriod,
        first.particleSeed
      )
      expect(movedSample.x).toBeCloseTo(originalSample.x, 12)
      expect(movedSample.y).toBeCloseTo(originalSample.y, 12)
      expect(movedSample.z).toBeCloseTo(originalSample.z, 12)
    })
  })

  it('moves survivors exactly once while births stay at the current origin', () => {
    const centerA = { x: -0.25, y: -0.125, z: 0.0625 }
    const centerB = { x: 0.25, y: 0.125, z: 0 }
    const localPosition = { x: 0.03125, y: 0.0625, z: -0.015625 }
    const previousPosition = add(centerA, localPosition)
    const currentOrigin = add(centerB, {
      x: -0.03125,
      y: 0.015625,
      z: 0.0078125,
    })

    const survivor = applyFireP027EmitterMotion(
      previousPosition,
      centerA,
      centerB,
      currentOrigin,
      false
    )
    const repeated = applyFireP027EmitterMotion(
      survivor.worldPosition,
      centerB,
      centerB,
      currentOrigin,
      false
    )
    const birth = applyFireP027EmitterMotion(
      previousPosition,
      centerA,
      centerB,
      currentOrigin,
      true
    )

    expect(survivor.centerDelta).toEqual({
      x: 0.5,
      y: 0.25,
      z: -0.0625,
    })
    expect(survivor.worldPosition).toEqual(
      add(previousPosition, survivor.centerDelta)
    )
    expect(survivor.localPosition).toEqual(localPosition)
    expect(repeated.centerDelta).toEqual({ x: 0, y: 0, z: 0 })
    expect(repeated.worldPosition).toEqual(survivor.worldPosition)
    expect(repeated.localPosition).toEqual(localPosition)
    expect(birth.worldPosition).toEqual(currentOrigin)
    expect(birth.worldPosition).not.toEqual(
      add(currentOrigin, survivor.centerDelta)
    )
    expect(birth.localPosition).toEqual({
      x: currentOrigin.x - centerB.x,
      y: currentOrigin.y - centerB.y,
      z: currentOrigin.z - centerB.z,
    })
  })

  it('preserves the same-seed local turbulence phase during pure translation', () => {
    const centerA = { x: -0.35, y: 0.12, z: 0.02 }
    const centerB = { x: 0.21, y: -0.16, z: -0.03 }
    const localPosition = { x: 0.037, y: -0.021, z: 0.014 }
    const previousPosition = add(centerA, localPosition)
    const motion = applyFireP027EmitterMotion(
      previousPosition,
      centerA,
      centerB,
      centerB,
      false
    )

    const originalSample = sampleFireP027LocalTurbulence(
      localPosition,
      0.01,
      413
    )
    const translatedSample = sampleFireP027LocalTurbulence(
      motion.localPosition,
      0.01,
      413
    )
    expect(translatedSample.x).toBeCloseTo(originalSample.x, 12)
    expect(translatedSample.y).toBeCloseTo(originalSample.y, 12)
    expect(translatedSample.z).toBeCloseTo(originalSample.z, 12)
  })

  it('mirrors horizontal turbulence while retaining deterministic local wrinkle', () => {
    const position = { x: 0.037, y: -0.021, z: 0.014 }
    const mirrored = { ...position, x: -position.x }
    const first = sampleFireP027LocalTurbulence(position, 0.01, 413)
    const repeated = sampleFireP027LocalTurbulence(position, 0.01, 413)
    const reflected = sampleFireP027LocalTurbulence(mirrored, 0.01, 413)
    const changedSeed = sampleFireP027LocalTurbulence(position, 0.01, 719)

    expect(repeated).toEqual(first)
    expect(reflected.x).toBeCloseTo(-first.x, 12)
    expect(reflected.y).toBeCloseTo(first.y, 12)
    expect(reflected.z).toBeCloseTo(first.z, 12)
    expect(changedSeed).not.toEqual(first)
    expect(
      Math.abs(first.x) + Math.abs(first.y) + Math.abs(first.z)
    ).toBeGreaterThan(0.01)
  })

  it('keeps the no-direction multi-seed ensemble centered without sustained bulk X drift', () => {
    const results = Array.from({ length: 16 }, (_, index) =>
      simulateNoDirection(index + 1)
    )

    for (const result of results) {
      expect(result.meanX).toBeCloseTo(0, 10)
      expect(result.meanVelocityX).toBeCloseTo(0, 10)
      expect(result.maximumPairError).toBeLessThan(1e-9)
    }
    expect(simulateNoDirection(9)).toEqual(simulateNoDirection(9))
    expect(results.some((result) => result.localMotion > 0.01)).toBe(true)
  })
})

function simulateNoDirection(seed: number) {
  const controls = mapFireParametersToP027Controls({ seed })
  const origins = generateFireP027FallbackOrigins(controls)
  const particles = origins.map((origin) => ({
    position: subtract(origin, controls),
    velocity: { x: 0, y: 0, z: 0 },
  }))
  const dt = 1 / 60

  for (let step = 0; step < 60; step += 1) {
    for (const particle of particles) {
      const noise = sampleFireP027LocalTurbulence(
        particle.position,
        controls.turbulencePeriod,
        controls.particleSeed
      )
      const acceleration = {
        x:
          controls.forceX +
          (controls.windX - particle.velocity.x) +
          noise.x * controls.turbulenceX,
        y:
          controls.forceY +
          (controls.windY - particle.velocity.y) +
          noise.y * controls.turbulenceY,
        z:
          controls.forceZ +
          (controls.windZ - particle.velocity.z) +
          noise.z * controls.turbulenceZ,
      }
      particle.velocity.x += acceleration.x * dt
      particle.velocity.y += acceleration.y * dt
      particle.velocity.z += acceleration.z * dt
      particle.position.x += particle.velocity.x * dt
      particle.position.y += particle.velocity.y * dt
      particle.position.z += particle.velocity.z * dt
    }
  }

  let maximumPairError = 0
  for (let index = 0; index < particles.length; index += 2) {
    const positive = particles[index]!
    const negative = particles[index + 1]!
    maximumPairError = Math.max(
      maximumPairError,
      Math.abs(positive.position.x + negative.position.x),
      Math.abs(positive.velocity.x + negative.velocity.x),
      Math.abs(positive.position.y - negative.position.y),
      Math.abs(positive.position.z - negative.position.z)
    )
  }
  return {
    meanX: average(particles.map((particle) => particle.position.x)),
    meanVelocityX: average(particles.map((particle) => particle.velocity.x)),
    maximumPairError,
    localMotion: average(
      particles.map((particle) => Math.abs(particle.position.x))
    ),
  }
}

function subtract(
  point: Readonly<FireP027VectorSample>,
  center: Readonly<{
    originCenterX: number
    originCenterY: number
    originCenterZ: number
  }>
): FireP027VectorSample {
  return {
    x: point.x - center.originCenterX,
    y: point.y - center.originCenterY,
    z: point.z - center.originCenterZ,
  }
}

function add(
  left: Readonly<FireP027VectorSample>,
  right: Readonly<FireP027VectorSample>
): FireP027VectorSample {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  }
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}
