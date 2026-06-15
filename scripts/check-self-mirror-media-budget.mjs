#!/usr/bin/env node

import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_TARGETS = ['output/playwright', '.cache/agent-os']
const ALLOWED_TARGET_ROOTS = ['output', '.cache/agent-os', 'test-runs']
const REDACTED_OUTSIDE_GENERATED_MEDIA_PATH =
  '<outside-generated-media-workspace>'
const MEDIA_EXTENSIONS = new Set([
  '.apng',
  '.avi',
  '.gif',
  '.jpeg',
  '.jpg',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.png',
  '.webm',
  '.webp',
])

function parseBytes(value, flagName) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flagName} must be a non-negative byte count`)
  }
  return Math.floor(parsed)
}

function parseArgs(argv) {
  const options = {
    maxBytes: DEFAULT_MAX_BYTES,
    reserveBytes: 0,
    targets: [],
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') {
      options.json = true
      continue
    }
    if (arg === '--max-bytes') {
      options.maxBytes = parseBytes(argv[++index], arg)
      continue
    }
    if (arg === '--reserve-bytes') {
      options.reserveBytes = parseBytes(argv[++index], arg)
      continue
    }
    if (arg === '--target') {
      const target = argv[++index]
      if (!target) throw new Error('--target requires a path')
      options.targets.push(target)
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.targets.length === 0) {
    options.targets.push(...DEFAULT_TARGETS)
  }

  return options
}

function isInsidePath(candidatePath, rootPath) {
  const relative = path.relative(rootPath, candidatePath)
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function allowedGeneratedMediaRoots(cwd) {
  return ALLOWED_TARGET_ROOTS.map((target) => path.resolve(cwd, target))
}

function resolveTargetPaths(cwd, targets) {
  const allowedRoots = allowedGeneratedMediaRoots(cwd)
  return targets.map((target) => {
    const resolved = path.resolve(cwd, target)
    if (!allowedRoots.some((root) => isInsidePath(resolved, root))) {
      throw new Error('--target is outside allowed generated-media roots')
    }
    return resolved
  })
}

async function walkMediaFiles(targetPath) {
  let targetStats
  try {
    targetStats = await stat(targetPath)
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }

  if (targetStats.isFile()) {
    return MEDIA_EXTENSIONS.has(path.extname(targetPath).toLowerCase())
      ? [{ file: targetPath, bytes: targetStats.size }]
      : []
  }
  if (!targetStats.isDirectory()) return []

  const entries = await readdir(targetPath, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => walkMediaFiles(path.join(targetPath, entry.name)))
  )
  return nested.flat()
}

function toWorkspaceRef(filePath, root) {
  const relative = path.relative(root, filePath)
  if (relative === '') return '.'
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return REDACTED_OUTSIDE_GENERATED_MEDIA_PATH
  }
  return relative
}

function hasPrivatePathLikeValue(value) {
  return /(?:file:\/\/|[a-zA-Z]:[\\/]|\\\\)/.test(value)
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GiB`
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
  }
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KiB`
  return `${bytes} B`
}

async function main() {
  const cwd = process.cwd()
  const options = parseArgs(process.argv.slice(2))
  const targetPaths = resolveTargetPaths(cwd, options.targets)
  const fileGroups = await Promise.all(targetPaths.map(walkMediaFiles))
  const files = fileGroups.flat()
  const currentBytes = files.reduce((sum, file) => sum + file.bytes, 0)
  const projectedBytes = currentBytes + options.reserveBytes
  const ok = projectedBytes <= options.maxBytes
  const largestFiles = files
    .toSorted((left, right) => right.bytes - left.bytes)
    .slice(0, 10)
    .map((file) => ({
      file: toWorkspaceRef(file.file, cwd),
      bytes: file.bytes,
    }))
  const targetRefs = targetPaths.map((target) => toWorkspaceRef(target, cwd))
  const emittedPathRefs = [
    ...targetRefs,
    ...largestFiles.map((file) => file.file),
  ]
  const privatePathsPublished = emittedPathRefs.some(hasPrivatePathLikeValue)

  const result = {
    ok,
    limit_bytes: options.maxBytes,
    current_bytes: currentBytes,
    reserve_bytes: options.reserveBytes,
    projected_bytes: projectedBytes,
    media_file_count: files.length,
    targets: targetRefs,
    largest_files: largestFiles,
    raw_media_published: false,
    private_paths_published: privatePathsPublished,
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(
      `Self Mirror media budget: ${formatBytes(projectedBytes)} / ${formatBytes(
        options.maxBytes
      )} (${files.length} files)`
    )
    for (const file of largestFiles) {
      console.log(`- ${file.file}: ${formatBytes(file.bytes)}`)
    }
  }

  if (!ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
