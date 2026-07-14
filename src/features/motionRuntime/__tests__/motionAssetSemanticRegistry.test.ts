import {
  parseMotionAssetSemanticRegistry,
  resolveSemanticMotionAssetPath,
} from '../motionAssetSemanticRegistry'

describe('motion asset semantic registry', () => {
  it('resolves only the asset explicitly registered for the requested semantic', () => {
    const value = JSON.stringify({
      greeting: '/local-vrma/route-local-motion-001.vrma',
      spin: '/local-vrma/route-local-motion-005.vrma',
    })

    expect(resolveSemanticMotionAssetPath('greeting', value)).toBe(
      '/local-vrma/route-local-motion-001.vrma'
    )
    expect(resolveSemanticMotionAssetPath('spin', value)).toBe(
      '/local-vrma/route-local-motion-005.vrma'
    )
    expect(resolveSemanticMotionAssetPath('dance', value)).toBeUndefined()
  })

  it.each([
    '',
    'not-json',
    '[]',
    '{}',
    JSON.stringify({ unknown: '/local-vrma/route-local-motion-001.vrma' }),
    JSON.stringify({ greeting: 'C:\\private\\motion.vrma' }),
    JSON.stringify({ greeting: 'https://example.test/motion.vrma' }),
    JSON.stringify({ greeting: '/local-vrma/../private.vrma' }),
    JSON.stringify({ greeting: '/local-vrma/subdir/motion.vrma' }),
    JSON.stringify({ greeting: '/local-vrma/.hidden.vrma' }),
  ])('fails closed for malformed or unsafe registry input', (value) => {
    expect(parseMotionAssetSemanticRegistry(value)).toBeUndefined()
  })

  it('rejects assigning the same asset path to two different semantics', () => {
    const value = JSON.stringify({
      greeting: '/local-vrma/route-local-motion-001.vrma',
      dance: '/local-vrma/route-local-motion-001.vrma',
    })

    expect(parseMotionAssetSemanticRegistry(value)).toBeUndefined()
    expect(resolveSemanticMotionAssetPath('dance', value)).toBeUndefined()
  })
})
