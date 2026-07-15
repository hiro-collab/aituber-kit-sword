import {
  AVATAR_LIGHTING_CONTRIBUTION_MAX_AGE_MS,
  getAvatarLightingContribution,
  publishAvatarLightingContribution,
  resetAvatarLightingContribution,
  subscribeToAvatarLightingContribution,
} from '../avatarLighting'

describe('avatar lighting contribution', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    resetAvatarLightingContribution()
  })

  afterEach(() => {
    resetAvatarLightingContribution()
    jest.useRealTimers()
  })

  it('publishes only the fixed bounded contract and deduplicates notifications', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeToAvatarLightingContribution(listener)
    const contribution = {
      status: 'active',
      intensityScale: 1.25,
      warmthClass: 'warm',
    } as const

    expect(publishAvatarLightingContribution(contribution)).toBe(true)
    expect(getAvatarLightingContribution()).toEqual(contribution)
    expect(Object.isFrozen(getAvatarLightingContribution())).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    expect(publishAvatarLightingContribution(contribution)).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it.each([
    [
      'extra field',
      {
        status: 'active',
        intensityScale: 1.2,
        warmthClass: 'warm',
        text: 'private',
      },
    ],
    [
      'URL-like field',
      {
        status: 'active',
        intensityScale: 1.2,
        warmthClass: 'warm',
        sourceUrl: 'file:///private',
      },
    ],
    [
      'not finite',
      {
        status: 'active',
        intensityScale: Number.POSITIVE_INFINITY,
        warmthClass: 'warm',
      },
    ],
    [
      'out of range',
      { status: 'active', intensityScale: 2, warmthClass: 'warm' },
    ],
    [
      'invalid warmth',
      { status: 'active', intensityScale: 1.2, warmthClass: 'hot' },
    ],
    [
      'invalid neutral',
      { status: 'neutral', intensityScale: 1.2, warmthClass: 'neutral' },
    ],
  ])('fails closed to neutral for %s', (_label, value) => {
    publishAvatarLightingContribution({
      status: 'active',
      intensityScale: 1.2,
      warmthClass: 'warm',
    })

    expect(publishAvatarLightingContribution(value)).toBe(false)
    expect(getAvatarLightingContribution()).toEqual({
      status: 'neutral',
      intensityScale: 1,
      warmthClass: 'neutral',
    })
  })

  it('expires an active sample to neutral when frame publication stops', () => {
    const listener = jest.fn()
    subscribeToAvatarLightingContribution(listener)
    publishAvatarLightingContribution({
      status: 'active',
      intensityScale: 1.3,
      warmthClass: 'warm',
    })

    jest.advanceTimersByTime(AVATAR_LIGHTING_CONTRIBUTION_MAX_AGE_MS - 1)
    expect(getAvatarLightingContribution().status).toBe('active')
    jest.advanceTimersByTime(1)

    expect(getAvatarLightingContribution()).toEqual({
      status: 'neutral',
      intensityScale: 1,
      warmthClass: 'neutral',
    })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('refreshes freshness without repeating an unchanged active sample', () => {
    const listener = jest.fn()
    subscribeToAvatarLightingContribution(listener)
    const contribution = {
      status: 'active',
      intensityScale: 1.15,
      warmthClass: 'warm',
    } as const
    publishAvatarLightingContribution(contribution)
    jest.advanceTimersByTime(AVATAR_LIGHTING_CONTRIBUTION_MAX_AGE_MS - 10)
    publishAvatarLightingContribution(contribution)
    jest.advanceTimersByTime(20)

    expect(getAvatarLightingContribution().status).toBe('active')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
