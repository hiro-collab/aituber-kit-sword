import {
  aiServiceOptions,
  getServiceConfigByKey,
} from '@/components/settings/modelProvider/utils/aiServiceConfigs'
import { buildReasoningProviderOptions } from '@/lib/api-services/providerOptionsBuilder'

const expectedCurrentProviders = [
  'openai',
  'anthropic',
  'google',
  'azure',
  'xai',
  'groq',
  'cohere',
  'mistralai',
  'perplexity',
  'fireworks',
  'deepseek',
  'openrouter',
  'lmstudio',
  'ollama',
  'custom-api',
  'thought-core',
] as const

describe('current provider options', () => {
  const selectableProviders = aiServiceOptions.map(({ value }) => value)

  it('exposes exactly the current provider set with no Dify option', () => {
    expect([...selectableProviders].sort()).toEqual(
      [...expectedCurrentProviders].sort()
    )
    expect(new Set(selectableProviders).size).toBe(
      expectedCurrentProviders.length
    )
    expect(selectableProviders).not.toContain('dify')
  })

  it('builds a matching keyed config for every selectable provider', () => {
    const configs = getServiceConfigByKey((key: string) => key)

    expect(Object.keys(configs).sort()).toEqual(
      [...expectedCurrentProviders].sort()
    )
    expect(configs).not.toHaveProperty('dify')
    for (const provider of selectableProviders) {
      expect(configs[provider].value).toBe(provider)
    }
  })
})

describe('buildReasoningProviderOptions current provider matrix', () => {
  const expectedOptions = {
    openai: {
      openai: { reasoningEffort: 'medium', reasoningSummary: 'detailed' },
    },
    anthropic: {
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 8192 },
      },
    },
    google: {
      google: {
        thinkingConfig: { thinkingBudget: 8192, includeThoughts: true },
      },
    },
    azure: { azure: { reasoningEffort: 'medium' } },
    xai: { xai: { reasoningEffort: 'medium' } },
    groq: { openai: { reasoningEffort: 'medium' } },
    cohere: {
      cohere: { thinking: { type: 'enabled', tokenBudget: 8192 } },
    },
  } as const

  it.each(aiServiceOptions.map(({ value }) => value))(
    'builds the current %s reasoning option behavior',
    (provider) => {
      expect(
        buildReasoningProviderOptions(
          provider,
          provider === 'google' ? 'gemini-2.5-flash' : 'current-model',
          true,
          'medium',
          8192
        )
      ).toEqual(expectedOptions[provider as keyof typeof expectedOptions])
    }
  )

  it('returns undefined for every provider when reasoning mode is disabled', () => {
    for (const provider of expectedCurrentProviders) {
      expect(
        buildReasoningProviderOptions(
          provider,
          'current-model',
          false,
          'medium',
          8192
        )
      ).toBeUndefined()
    }
  })

  it('uses Groq qwen3 default effort', () => {
    expect(
      buildReasoningProviderOptions(
        'groq',
        'qwen/qwen3-32b',
        true,
        'high',
        8192
      )
    ).toEqual({ openai: { reasoningEffort: 'default' } })
  })

  it('adds Anthropic effort only for Opus 4.5', () => {
    expect(
      buildReasoningProviderOptions(
        'anthropic',
        'claude-opus-4-5',
        true,
        'medium',
        12000
      )
    ).toEqual({
      anthropic: {
        thinking: { type: 'enabled', budgetTokens: 12000 },
        effort: 'medium',
      },
    })
  })

  it('uses Google thinking level for Gemini 3 models', () => {
    expect(
      buildReasoningProviderOptions(
        'google',
        'gemini-3-pro-preview',
        true,
        'high',
        8192
      )
    ).toEqual({
      google: {
        thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
      },
    })
  })

  it.each(['unsupported-service', 'dify'])(
    'returns undefined for unsupported runtime provider %s',
    (provider) => {
      expect(
        buildReasoningProviderOptions(
          provider,
          'current-model',
          true,
          'medium',
          8192
        )
      ).toBeUndefined()
    }
  )
})
