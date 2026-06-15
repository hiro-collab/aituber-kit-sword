import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(
  new URL('./check-self-mirror-media-budget.mjs', import.meta.url)
)
const appRoot = path.resolve(path.dirname(scriptPath), '..')

function runBudgetScript(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: appRoot,
    encoding: 'utf8',
  })
}

function assertNoAbsolutePrivatePath(text) {
  assert.equal(/(?:file:\/\/|[a-zA-Z]:[\\/]|\\\\\\\\)/.test(text), false)
}

test('emits workspace-relative refs for generated-media targets', async () => {
  const runId = `media-budget-test-${process.pid}-${Date.now()}`
  const relativeTarget = path.join('.cache', 'agent-os', runId)
  const target = path.join(appRoot, relativeTarget)
  const mediaFile = path.join(target, 'sample.png')
  await mkdir(target, { recursive: true })
  await writeFile(mediaFile, Buffer.alloc(32))

  try {
    const result = runBudgetScript(['--json', '--target', target])
    assert.equal(result.status, 0, result.stderr)
    assertNoAbsolutePrivatePath(result.stdout)
    assertNoAbsolutePrivatePath(result.stderr)

    const summary = JSON.parse(result.stdout)
    assert.equal(summary.ok, true)
    assert.equal(summary.current_bytes, 32)
    assert.deepEqual(summary.targets, [relativeTarget])
    assert.deepEqual(summary.largest_files, [
      { file: path.join(relativeTarget, 'sample.png'), bytes: 32 },
    ])
    assert.equal(summary.raw_media_published, false)
    assert.equal(summary.private_paths_published, false)
  } finally {
    await rm(target, { force: true, recursive: true })
  }
})

test('rejects outside generated-media targets without publishing paths', async () => {
  const outside = await mkdtemp(
    path.join(os.tmpdir(), 'rr003-media-budget-outside-')
  )
  await writeFile(path.join(outside, 'outside.png'), Buffer.alloc(16))

  try {
    const result = runBudgetScript(['--json', '--target', outside])
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /outside allowed generated-media roots/)
    assertNoAbsolutePrivatePath(result.stdout)
    assertNoAbsolutePrivatePath(result.stderr)
    assert.equal(result.stdout.trim(), '')
  } finally {
    await rm(outside, { force: true, recursive: true })
  }
})
