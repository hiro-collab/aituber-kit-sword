import path from 'path'

export function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, '/')
}

export function sanitizePathSegment(
  value: string | null | undefined,
  pattern: RegExp = /^[A-Za-z0-9._-]+$/
): string | null {
  if (!value) return null

  const normalized = normalizePathSeparators(value)
  const baseName = path.basename(normalized)
  if (baseName !== normalized) return null
  if (baseName === '.' || baseName === '..' || baseName.includes('..')) {
    return null
  }
  if (!pattern.test(baseName)) return null

  return baseName
}

export function resolveInsideDirectory(
  directory: string,
  ...segments: string[]
): string {
  const resolvedDirectory = path.resolve(directory)
  const resolvedPath = path.resolve(resolvedDirectory, ...segments)
  const relativePath = path.relative(resolvedDirectory, resolvedPath)

  if (
    relativePath === '' ||
    relativePath.startsWith('..') ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Resolved path escapes the target directory')
  }

  return resolvedPath
}
