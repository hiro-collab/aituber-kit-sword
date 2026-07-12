import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ATTEMPT_COUNT,
  ATTEMPT_TIMEOUT_MS,
  ROUTE_CANCEL_SETTLE_MS,
  ROUTE_TIMEOUT_MS,
  ControllerError,
  buildOperatorServerOwnerInspectionScript,
  createPublicChildEnvironment,
  requireBrowserAudioAvailability,
  resolveOperatorServerMode,
  runPreparedSampleController,
  stopTrackedServer,
} from './collect-prepared-sample-browser-stt-playback.mjs'

const privateExpectedText = 'PRIVATE_EXPECTED_TEXT_SENTINEL'
const fixtureAitRoot = 'C:\\fixture\\ait'
const fixtureStart = '2025-01-01T00:00:00.000Z'

const toDotNetTicks = (value) =>
  (BigInt(Date.parse(value)) * 10_000n + 621_355_968_000_000_000n).toString()

const runOwnerInspectionFixture = ({ listeners, processes }) => {
  const windowsPowerShell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const fixturePrelude = [
    "$fixture=$env:SWORD_TEST_PROCESS_FIXTURE | ConvertFrom-Json",
    'function Get-NetTCPConnection {',
    '  param($State,$LocalPort,$ErrorAction)',
    '  @($fixture.listeners | ForEach-Object { [pscustomobject]@{ LocalAddress=[string]$_.localAddress; OwningProcess=[int]$_.owningProcess } })',
    '}',
    'function Get-CimInstance {',
    '  param($ClassName,$Filter,$ErrorAction)',
    "  $processId=[int]([regex]::Match([string]$Filter,'\\d+').Value)",
    '  $row=@($fixture.processes | Where-Object { [int]$_.processId -eq $processId } | Select-Object -First 1)',
    '  if($row.Count -eq 0){return $null}',
    '  $item=$row[0]',
    '  [pscustomobject]@{',
    '    ProcessId=[int]$item.processId',
    '    ParentProcessId=[int]$item.parentProcessId',
    '    Name=[string]$item.name',
    '    CommandLine=[string]$item.commandLine',
    '    CreationDate=[datetime]::Parse([string]$item.creationDate,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind)',
    '  }',
    '}',
  ].join('\n')
  const result = spawnSync(
    windowsPowerShell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `${fixturePrelude}\n${buildOperatorServerOwnerInspectionScript(3000)}`,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        SWORD_EXPECTED_AIT_ROOT: fixtureAitRoot,
        SWORD_TEST_PROCESS_FIXTURE: JSON.stringify({ listeners, processes }),
      },
      timeout: 5_000,
      windowsHide: true,
    }
  )
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const processFixture = ({
  processId,
  parentProcessId = 0,
  name = 'node.exe',
  commandLine,
  creationDate = fixtureStart,
}) => ({
  processId,
  parentProcessId,
  name,
  commandLine,
  creationDate,
})

const listenerFixture = (owningProcess) => ({
  localAddress: '127.0.0.1',
  owningProcess,
})

const nextDevCommand = ({
  root = fixtureAitRoot,
  host = '127.0.0.1',
  port = 3000,
  optionStyle = 'short',
  suffix = '',
} = {}) =>
  `${root}\\node_modules\\next\\dist\\bin\\next dev ${
    optionStyle === 'long' ? '--hostname' : '-H'
  } ${host} ${optionStyle === 'long' ? '--port' : '-p'} ${port}${suffix}`

const nextChildCommand = ({
  root = fixtureAitRoot,
  module = 'start-server.js',
} = {}) =>
  `${root}\\node_modules\\next\\dist\\server\\lib\\${module}`

const createFakeAdapter = ({
  outcomeClass = 'final_result',
  playerExitClass = 'exit_zero',
  stabilityClass = 'stable_positive',
  acquireError = null,
  startServerBarrier = null,
  startPlaybackBarrier = null,
  cleanupErrorAt = null,
  localeError = null,
  playerRemainsAlive = false,
  externalRevalidateError = null,
} = {}) => {
  const events = []
  let resultCount = 0
  let finalCount = 0
  let attempts = 0
  return {
    events,
    async acquireLock() {
      events.push('lock')
      if (acquireError) throw new ControllerError(acquireError)
    },
    async releaseLock() {
      events.push('release-lock')
      if (cleanupErrorAt === 'releaseLock') throw new Error('private detail')
    },
    async startServer() {
      events.push('server-start')
      if (startServerBarrier) await startServerBarrier
    },
    async stopServer() {
      events.push('server-stop')
      if (cleanupErrorAt === 'stopServer') throw new Error('private detail')
    },
    async launchBrowser() {
      events.push('browser-launch')
    },
    async closeBrowser() {
      events.push('browser-close')
      if (cleanupErrorAt === 'closeBrowser') throw new Error('private detail')
    },
    async requireLiveAudioInput() {
      events.push('audio-input-live')
    },
    async fillExpectedText(text) {
      assert.equal(text, privateExpectedText)
      events.push('fill-private-text')
    },
    async revalidateExternalServer() {
      events.push('external-server-revalidated')
      if (externalRevalidateError) {
        throw new ControllerError(externalRevalidateError)
      }
    },
    async startAttempt() {
      attempts += 1
      events.push(`attempt-${attempts}-start`)
    },
    async waitForStatus(status, timeoutMs) {
      assert.equal(timeoutMs, ATTEMPT_TIMEOUT_MS)
      events.push(status)
    },
    async readDiagnosticCounts() {
      return { resultCount, finalCount }
    },
    async requireRecognitionLocale() {
      events.push('locale-verified')
      if (localeError) throw new ControllerError(localeError)
    },
    async startPlayback() {
      events.push('playback-start')
      if (startPlaybackBarrier) await startPlaybackBarrier
      return { attempt: attempts }
    },
    async stopPlayback() {
      events.push('playback-stop')
      if (playerRemainsAlive) {
        throw new ControllerError('cleanup_incomplete')
      }
      return { exitClass: playerExitClass }
    },
    async waitForAttemptOutcome({ timeoutMs }) {
      assert.equal(timeoutMs, ATTEMPT_TIMEOUT_MS + 2_000)
      events.push(`outcome-${outcomeClass}`)
      if (outcomeClass === 'final_result') {
        resultCount += 1
        finalCount += 1
      }
      return { class: outcomeClass }
    },
    async recordFinalResult() {
      events.push('record-final')
    },
    async readRunSummary() {
      return { attemptCount: attempts, stabilityClass }
    },
    async stopRecognition() {
      events.push('recognition-stop')
      if (cleanupErrorAt === 'stopRecognition') throw new Error('private detail')
    },
    async deleteTempResources() {
      events.push('temp-delete')
      if (cleanupErrorAt === 'deleteTempResources') {
        throw new Error('private detail')
      }
    },
  }
}

test('runs exactly five attempts and starts playback only after listening', async () => {
  const adapter = createFakeAdapter()
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'completed')
  assert.equal(result.attempt_count, ATTEMPT_COUNT)
  assert.equal(result.playback_start_count, ATTEMPT_COUNT)
  assert.equal(result.playback_exit_zero_count, ATTEMPT_COUNT)
  assert.equal(result.final_result_count, ATTEMPT_COUNT)
  assert.equal(result.content_match_stability_class, 'stable_positive')
  assert.equal(JSON.stringify(result).includes(privateExpectedText), false)

  const listeningIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'attempt_listening')
    .map(([, index]) => index)
  const playbackIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'playback-start')
    .map(([, index]) => index)
  assert.equal(listeningIndexes.length, ATTEMPT_COUNT)
  assert.equal(playbackIndexes.length, ATTEMPT_COUNT)
  for (let index = 0; index < ATTEMPT_COUNT; index += 1) {
    assert.ok(listeningIndexes[index] < playbackIndexes[index])
  }
  assert.equal(
    adapter.events.filter((event) => event === 'locale-verified').length,
    ATTEMPT_COUNT
  )
  assert.equal(
    adapter.events.filter(
      (event) => event === 'external-server-revalidated'
    ).length,
    ATTEMPT_COUNT
  )
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
})

test('fails closed on timeout and still performs complete cleanup', async () => {
  const adapter = createFakeAdapter({ outcomeClass: 'attempt_timeout' })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(
    result.blocker_class,
    'browser_stt_no_final_result_before_timeout'
  )
  assert.equal(result.playback_start_count, 1)
  assert.ok(adapter.events.includes('playback-stop'))
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
})

test('fails closed on nonzero playback and does not continue attempts', async () => {
  const adapter = createFakeAdapter({ playerExitClass: 'exit_nonzero' })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'playback_exit_nonzero')
  assert.equal(result.playback_start_count, 1)
})

test('rejects a recognition locale mismatch before playback', async () => {
  const adapter = createFakeAdapter({
    localeError: 'browser_stt_locale_mismatch',
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'browser_stt_locale_mismatch')
  assert.equal(adapter.events.includes('playback-start'), false)
})

test('rejects external owner drift before private expected-text use', async () => {
  const adapter = createFakeAdapter({
    externalRevalidateError: 'operator_server_collision',
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'operator_server_collision')
  assert.equal(adapter.events.includes('fill-private-text'), false)
  assert.equal(adapter.events.includes('playback-start'), false)
})

test('reports lock collision without starting server or browser', async () => {
  const adapter = createFakeAdapter({ acquireError: 'controller_lock_held' })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'controller_lock_held')
  assert.equal(adapter.events.includes('server-start'), false)
  assert.equal(adapter.events.includes('browser-launch'), false)
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
})

test('attaches only to the exact existing operator surface', async () => {
  const operatorUrl =
    'http://127.0.0.1:3000/operator/prepared-sample-stt'
  const identity = { pid: 42, startTicks: '638000000000000000' }
  assert.deepEqual(
    await resolveOperatorServerMode({
      canBind: async () => true,
      inspectOwner: async () => null,
      probe: async () => false,
      operatorUrl,
    }),
    { serverMode: 'start_owned', externalServerIdentity: null }
  )
  assert.deepEqual(
    await resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => identity,
      probe: async () => true,
      operatorUrl,
    }),
    { serverMode: 'attach_external', externalServerIdentity: identity }
  )
  await assert.rejects(
    resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => identity,
      probe: async () => false,
      operatorUrl,
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'operator_server_collision'
  )
  await assert.rejects(
    resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => null,
      probe: async () => true,
      operatorUrl,
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'operator_server_collision'
  )
})

test('rejects an external operator owner swap after SSR probing', async () => {
  const identities = [
    { pid: 42, startTicks: '638000000000000000' },
    { pid: 43, startTicks: '638000000000000100' },
  ]
  await assert.rejects(
    resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => identities.shift() ?? null,
      probe: async () => true,
      operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt',
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'operator_server_collision'
  )
})

test('accepts only a direct Next dev owner or its sealed listener child', () => {
  const script = buildOperatorServerOwnerInspectionScript(3000)

  assert.match(script, /Get-NetTCPConnection -State Listen -LocalPort 3000/)
  assert.match(script, /ParentProcessId/)
  assert.match(script, /\$directOwned=/)
  assert.match(script, /\$parentOwned=/)
  assert.match(script, /\$sealedChild=/)
  assert.match(script, /node_modules\\next\\dist\\server\\lib\\start-server/)
  assert.match(script, /node_modules\\next\\dist\\bin\\next/)
  assert.match(script, /-H\|--hostname/)
  assert.match(script, /-p\|--port/)
  assert.match(script, /hostFlags\.Count -eq 1/)
  assert.match(script, /portFlags\.Count -eq 1/)
  assert.match(script, /\$owned=\$directOwned -or \$sealedChild/)
})

test('classifies direct and sealed-child Next ownership behaviorally', () => {
  const expectedTicks = toDotNetTicks(fixtureStart)
  const directOwner = processFixture({
    processId: 99,
    commandLine: nextDevCommand(),
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [directOwner],
    }),
    `owned:99:${expectedTicks}`
  )

  const exactParent = processFixture({
    processId: 55,
    commandLine: nextDevCommand(),
  })
  const exactChild = processFixture({
    processId: 99,
    parentProcessId: 55,
    commandLine: nextChildCommand(),
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [exactChild, exactParent],
    }),
    `owned:99:${expectedTicks}`
  )

  const canonicalParent = processFixture({
    processId: 55,
    commandLine: nextDevCommand({ optionStyle: 'long' }),
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [exactChild, canonicalParent],
    }),
    `owned:99:${expectedTicks}`
  )

  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          commandLine: nextDevCommand({ optionStyle: 'long' }),
        }),
      ],
    }),
    `owned:99:${expectedTicks}`
  )

  const rejectedCases = [
    {
      name: 'missing immediate parent',
      listeners: [listenerFixture(99)],
      processes: [exactChild],
    },
    {
      name: 'exact grandparent only',
      listeners: [listenerFixture(99)],
      processes: [
        exactChild,
        processFixture({
          processId: 55,
          parentProcessId: 44,
          commandLine: `${fixtureAitRoot}\\metadata-only.js`,
        }),
        processFixture({
          processId: 44,
          commandLine: nextDevCommand(),
        }),
      ],
    },
    {
      name: 'metadata sibling',
      listeners: [listenerFixture(77)],
      processes: [
        processFixture({
          processId: 77,
          parentProcessId: 55,
          commandLine: `${fixtureAitRoot}\\camera_hub_stack metadata`,
        }),
        exactParent,
        exactChild,
      ],
    },
    {
      name: 'wrong root',
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: nextChildCommand({ root: 'C:\\other' }),
        }),
        exactParent,
      ],
    },
    {
      name: 'wrong child module',
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: nextChildCommand({ module: 'other.js' }),
        }),
        exactParent,
      ],
    },
    {
      name: 'wrong child process name',
      listeners: [listenerFixture(99)],
      processes: [{ ...exactChild, name: 'python.exe' }, exactParent],
    },
    {
      name: 'multiple loopback owners',
      listeners: [listenerFixture(99), listenerFixture(100)],
      processes: [
        exactChild,
        exactParent,
        processFixture({ processId: 100, commandLine: nextDevCommand() }),
      ],
    },
  ]
  for (const fixture of rejectedCases) {
    assert.equal(
      runOwnerInspectionFixture(fixture),
      'unowned',
      fixture.name
    )
  }

  const nextBin = `${fixtureAitRoot}\\node_modules\\next\\dist\\bin\\next`
  const invalidCommands = [
    { name: 'missing host', commandLine: `${nextBin} dev -p 3000` },
    { name: 'missing port', commandLine: `${nextBin} dev -H 127.0.0.1` },
    { name: 'wrong host', commandLine: nextDevCommand({ host: '0.0.0.0' }) },
    { name: 'wrong port', commandLine: nextDevCommand({ port: 3001 }) },
    {
      name: 'duplicate equivalent host',
      commandLine: nextDevCommand({ suffix: ' --hostname 127.0.0.1' }),
    },
    {
      name: 'duplicate equivalent port',
      commandLine: nextDevCommand({ suffix: ' --port 3000' }),
    },
    {
      name: 'contradictory host',
      commandLine: nextDevCommand({ suffix: ' --hostname 0.0.0.0' }),
    },
    {
      name: 'contradictory port',
      commandLine: nextDevCommand({ suffix: ' --port 3001' }),
    },
    {
      name: 'lowercase short host flag',
      commandLine: nextDevCommand().replace(' -H ', ' -h '),
    },
    {
      name: 'uppercase long host flag',
      commandLine: nextDevCommand({ optionStyle: 'long' }).replace(
        ' --hostname ',
        ' --HOSTNAME '
      ),
    },
    {
      name: 'uppercase short port flag',
      commandLine: nextDevCommand().replace(' -p ', ' -P '),
    },
    {
      name: 'uppercase long port flag',
      commandLine: nextDevCommand({ optionStyle: 'long' }).replace(
        ' --port ',
        ' --PORT '
      ),
    },
  ]
  for (const fixture of invalidCommands) {
    assert.equal(
      runOwnerInspectionFixture({
        listeners: [listenerFixture(99)],
        processes: [
          processFixture({ processId: 99, commandLine: fixture.commandLine }),
        ],
      }),
      'unowned',
      `direct owner: ${fixture.name}`
    )
    assert.equal(
      runOwnerInspectionFixture({
        listeners: [listenerFixture(99)],
        processes: [
          exactChild,
          processFixture({ processId: 55, commandLine: fixture.commandLine }),
        ],
      }),
      'unowned',
      `sealed child: ${fixture.name}`
    )
  }
})

test('waits for cooperative cancellation before route-timeout cleanup', async () => {
  const adapter = createFakeAdapter({
    startServerBarrier: new Promise((resolve) => setTimeout(resolve, 10)),
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    routeTimeoutMs: 5,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'whole_route_timeout')
  assert.equal(adapter.events.includes('browser-launch'), false)
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
})

test('quarantines a non-cooperative route after bounded cancellation settlement', async () => {
  let releaseStartServer
  const startServerBarrier = new Promise((resolve) => {
    releaseStartServer = resolve
  })
  const adapter = createFakeAdapter({
    startServerBarrier,
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    routeTimeoutMs: 5,
    routeCancelSettleMs: 5,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'cleanup_incomplete')
  assert.equal(result.cleanup_class, 'cleanup_incomplete')
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
  const eventsAtReturn = [...adapter.events]
  releaseStartServer()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(adapter.events, eventsAtReturn)
  assert.equal(adapter.events.includes('browser-launch'), false)
})

test('tracks and stops a player that materializes during route cancellation', async () => {
  const adapter = createFakeAdapter({
    startPlaybackBarrier: new Promise((resolve) => setTimeout(resolve, 10)),
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    routeTimeoutMs: 5,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'whole_route_timeout')
  assert.equal(result.playback_start_count, 1)
  assert.equal(
    adapter.events.filter((event) => event === 'playback-stop').length,
    1
  )
  assert.equal(adapter.events.includes('record-final'), false)
})

test('reports a surviving owned player as cleanup incomplete and keeps retrying it', async () => {
  const adapter = createFakeAdapter({ playerRemainsAlive: true })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'cleanup_incomplete')
  assert.equal(result.cleanup_class, 'cleanup_incomplete')
  assert.equal(
    adapter.events.filter((event) => event === 'playback-stop').length,
    2
  )
})

test('retains a non-exiting owned server and never terminates an external server', async () => {
  const ownedChild = {
    exitCode: null,
    killCalls: [],
    kill(signal) {
      this.killCalls.push(signal ?? 'graceful')
    },
  }
  await assert.rejects(
    stopTrackedServer({
      serverMode: 'start_owned',
      serverChild: ownedChild,
      waitForExit: async () => null,
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'cleanup_incomplete'
  )
  assert.equal(ownedChild.exitCode, null)
  assert.deepEqual(ownedChild.killCalls, ['graceful', 'SIGKILL'])

  let externalKillCount = 0
  const external = await stopTrackedServer({
    serverMode: 'attach_external',
    serverChild: {
      exitCode: null,
      kill() {
        externalKillCount += 1
      },
    },
    waitForExit: async () => null,
  })
  assert.deepEqual(external, { serverMode: 'none', serverChild: null })
  assert.equal(externalKillCount, 0)
})

test('reports cleanup failure as a fixed non-echoing result', async () => {
  const adapter = createFakeAdapter({ cleanupErrorAt: 'closeBrowser' })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'cleanup_incomplete')
  assert.equal(result.cleanup_class, 'cleanup_incomplete')
  assert.equal(JSON.stringify(result).includes('private detail'), false)
})

test('strips all route-private values from server and browser children', () => {
  const privateEnvironment = {
    PUBLIC_MARKER: 'retained',
    SWORD_PREPARED_SAMPLE_OPERATOR_URL: 'private',
    SWORD_PREPARED_SAMPLE_AUDIO_PATH: 'private',
    SWORD_PREPARED_SAMPLE_EXPECTED_TEXT: 'private',
    SWORD_PREPARED_SAMPLE_LOCALE: 'private',
    SWORD_PREPARED_SAMPLE_FFPLAY_PATH: 'private',
    SWORD_PREPARED_SAMPLE_LOCK_CLASS: 'private',
  }
  const childEnvironment = createPublicChildEnvironment(privateEnvironment)

  assert.equal(childEnvironment.PUBLIC_MARKER, 'retained')
  for (const key of Object.keys(privateEnvironment).filter((key) =>
    key.startsWith('SWORD_PREPARED_SAMPLE_')
  )) {
    assert.equal(Object.hasOwn(childEnvironment, key), false)
  }
})

test('requires normal-browser input, live track, and output availability', () => {
  assert.doesNotThrow(() =>
    requireBrowserAudioAvailability({
      permissionAvailable: true,
      live: true,
      inputCount: 1,
      outputCount: 1,
    })
  )
  for (const [value, blockerClass] of [
    [
      { permissionAvailable: false, live: false, inputCount: 0, outputCount: 0 },
      'browser_microphone_permission_or_device_unavailable',
    ],
    [
      { permissionAvailable: true, live: false, inputCount: 1, outputCount: 1 },
      'browser_audio_input_track_not_live',
    ],
    [
      { permissionAvailable: true, live: true, inputCount: 1, outputCount: 0 },
      'browser_audio_output_device_unavailable',
    ],
  ]) {
    assert.throws(
      () => requireBrowserAudioAvailability(value),
      (error) =>
        error instanceof ControllerError &&
        error.resultClass === blockerClass
    )
  }
})

test('locks route bounds and forbids fake audio-device substitution', async () => {
  assert.equal(ATTEMPT_COUNT, 5)
  assert.equal(ATTEMPT_TIMEOUT_MS, 10_000)
  assert.equal(ROUTE_CANCEL_SETTLE_MS, 2_000)
  assert.equal(ROUTE_TIMEOUT_MS, 90_000)

  const source = await readFile(
    fileURLToPath(
      new URL('./collect-prepared-sample-browser-stt-playback.mjs', import.meta.url)
    ),
    'utf8'
  )
  assert.match(source, /--use-fake-ui-for-media-stream/)
  assert.doesNotMatch(source, /--use-fake-device-for-media-stream/)
  assert.match(source, /stopTrackedServer/)
  assert.match(source, /serverMode !== 'start_owned'/)
  assert.match(source, /parent_preflight_mount_pending/)
  assert.match(source, /Get-NetTCPConnection/)
  assert.match(source, /parseOperatorServerIdentity/)
  assert.match(source, /CreationDate\.ToUniversalTime\(\)\.Ticks/)
  assert.match(source, /buildOperatorServerOwnerInspectionScript/)
  assert.match(source, /node_modules\\\\next\\\\dist\\\\server\\\\lib\\\\start-server/)
  assert.match(source, /revalidateExternalServer/)
  assert.match(source, /clearPrivateProcessEnvironment\(\)/)
  assert.match(source, /lockClass !== 'held_by_parent'/)
  const privateEnvironmentBlock =
    source.match(/const PRIVATE_ENV_KEYS = \[([\s\S]*?)\]/)?.[1] ?? ''
  for (const key of [
    'SWORD_PREPARED_SAMPLE_OPERATOR_URL',
    'SWORD_PREPARED_SAMPLE_AUDIO_PATH',
    'SWORD_PREPARED_SAMPLE_EXPECTED_TEXT',
    'SWORD_PREPARED_SAMPLE_LOCALE',
    'SWORD_PREPARED_SAMPLE_FFPLAY_PATH',
    'SWORD_PREPARED_SAMPLE_LOCK_CLASS',
  ]) {
    assert.match(privateEnvironmentBlock, new RegExp(key))
  }
  assert.match(source, /pipe:0/)
  assert.doesNotMatch(source, /spawn\([\s\S]{0,300}audioPath/)
})
