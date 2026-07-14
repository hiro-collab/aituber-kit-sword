export const MOTION_ASSET_SEMANTIC_REGISTRY_JSON_ENV =
  'NEXT_PUBLIC_MOTION_ASSET_SEMANTIC_REGISTRY_JSON'

export const SUPPORTED_MOTION_ASSET_SEMANTICS = [
  'dance',
  'show_full_body',
  'greeting',
  'peace_sign',
  'shoot_pose',
  'spin',
  'model_pose',
  'squat',
] as const

export type MotionAssetSemantic =
  (typeof SUPPORTED_MOTION_ASSET_SEMANTICS)[number]

export type MotionAssetSemanticRegistry = Partial<
  Record<MotionAssetSemantic, string>
>

const SUPPORTED_SEMANTIC_SET = new Set<string>(SUPPORTED_MOTION_ASSET_SEMANTICS)
const SAFE_PUBLIC_MOTION_ASSET_PATH_PATTERN =
  /^\/local-vrma\/[a-z0-9_-][a-z0-9._-]*\.vrma$/i
const MAX_REGISTRY_JSON_LENGTH = 4096

export function parseMotionAssetSemanticRegistry(
  value: unknown
): MotionAssetSemanticRegistry | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (!text || text.length > MAX_REGISTRY_JSON_LENGTH) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined

  const registry: MotionAssetSemanticRegistry = {}
  const assignedPaths = new Set<string>()
  for (const [semantic, path] of Object.entries(parsed)) {
    if (
      !SUPPORTED_SEMANTIC_SET.has(semantic) ||
      typeof path !== 'string' ||
      !SAFE_PUBLIC_MOTION_ASSET_PATH_PATTERN.test(path) ||
      assignedPaths.has(path)
    ) {
      return undefined
    }
    assignedPaths.add(path)
    registry[semantic as MotionAssetSemantic] = path
  }

  return Object.keys(registry).length > 0 ? registry : undefined
}

export function resolveSemanticMotionAssetPath(
  semantic: MotionAssetSemantic,
  value = process.env.NEXT_PUBLIC_MOTION_ASSET_SEMANTIC_REGISTRY_JSON
): string | undefined {
  return parseMotionAssetSemanticRegistry(value)?.[semantic]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
