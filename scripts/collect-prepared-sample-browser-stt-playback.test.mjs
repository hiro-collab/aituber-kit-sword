import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ATTEMPT_COUNT,
  ATTEMPT_TIMEOUT_MS,
  AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
  AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
  BROWSER_PLAYBACK_GAIN_DB,
  BROWSER_PLAYBACK_GAIN_LINEAR,
  INTEGRATED_ATTEMPT_COUNT,
  EXTERNAL_OPERATOR_SURFACE_PROBE_ATTEMPTS,
  EXTERNAL_OPERATOR_SURFACE_PROBE_DELAY_MS,
  OPERATOR_OWNER_INSPECTION_TIMEOUT_MS,
  OPERATOR_OWNER_TERMINATION_STEP_MS,
  PRESENTATION_TIMEOUT_MS,
  RECOGNITION_DRAIN_TIMEOUT_MS,
  ROUTE_CANCEL_SETTLE_MS,
  ROUTE_TIMEOUT_MS,
  SAFE_PUBLIC_CHILD_ENV_KEYS,
  ControllerError,
  buildOperatorServerOwnerInspectionScript,
  classifyFixedAudioEndpointSelection,
  createPublicChildEnvironment,
  createRuntimeAdapter,
  inspectOperatorServerOwner,
  openCanonicalPresentationPages,
  releaseBrowserRoutedPlayback,
  requireBrowserAudioAvailability,
  resolveBrowserLaunchArgs,
  resolveOperatorServerMode,
  runPreparedSampleController,
  selectBrowserAudioRoute,
  startBrowserRoutedPlayback,
  stopTrackedServer,
  validateRouteOptions,
  waitForAcceptedCandidateCompletion,
} from './collect-prepared-sample-browser-stt-playback.mjs'

test('opens Projection Visual first and then its exact operator child', async () => {
  const order = []
  const operatorPage = {
    async waitForLoadState(state) {
      order.push(`operator:${state}`)
    },
  }
  const projectionPage = {
    async goto(url, options) {
      order.push(`projection:${url}:${options.waitUntil}`)
    },
    async waitForFunction(_predicate, _argument, options) {
      assert.equal(options.timeout, PRESENTATION_TIMEOUT_MS)
      order.push('projection:owner-ready')
    },
    async evaluate(_callback, targetUrl) {
      order.push(`projection:open-child:${targetUrl}`)
    },
  }
  const context = {
    pages: () => [projectionPage],
    async waitForEvent(event, options) {
      assert.equal(event, 'page')
      assert.equal(options.timeout, PRESENTATION_TIMEOUT_MS)
      order.push('context:wait-child')
      return operatorPage
    },
  }

  const pages = await openCanonicalPresentationPages({
    context,
    operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt?opaque=1',
  })

  assert.equal(pages.projectionPage, projectionPage)
  assert.equal(pages.operatorPage, operatorPage)
  assert.deepEqual(order, [
    'projection:http://127.0.0.1:3000/projection-visual:domcontentloaded',
    'projection:owner-ready',
    'context:wait-child',
    'projection:open-child:http://127.0.0.1:3000/operator/prepared-sample-stt?opaque=1',
    'operator:domcontentloaded',
  ])
  assert.equal(PRESENTATION_TIMEOUT_MS, 75_000)
  assert.ok(PRESENTATION_TIMEOUT_MS < ROUTE_TIMEOUT_MS)
})

const privateExpectedText = 'PRIVATE_EXPECTED_TEXT_SENTINEL'
const fixtureAitRoot = 'C:\\fixture\\ait'
const fixtureStart = '2025-01-01T00:00:00.000Z'

const createBrowserCleanupFixture = ({
  privateMarker,
  releaseTrack,
  closeContext,
}) => {
  const counts = { evaluate: 0, release: 0, routedClose: 0, contextClose: 0 }
  const privateWindow = {
    __preparedSampleSttAudioInputDeviceId: privateMarker,
    __preparedSampleSttAudioOutputDeviceId: privateMarker,
    __preparedSampleBrowserRoutedPlayer: {
      audio: {
        pause() {},
        removeAttribute() {},
        load() {},
      },
      context: {
        async close() {
          counts.routedClose += 1
        },
      },
      source: null,
      gain: null,
      objectUrl: null,
      exitClass: null,
      mediaElementCleanupAttempted: false,
      graphDisconnectAttempted: false,
      objectUrlRevokeAttempted: false,
      contextCloseAttempted: false,
      cleanupClass: null,
    },
    __preparedSampleSttReleaseAudioTrack() {
      counts.release += 1
      return releaseTrack()
    },
  }
  const page = {
    async evaluate(operation) {
      counts.evaluate += 1
      const originalWindow = globalThis.window
      globalThis.window = privateWindow
      try {
        return await operation()
      } finally {
        if (originalWindow === undefined) delete globalThis.window
        else globalThis.window = originalWindow
      }
    },
  }
  const context = {
    async close() {
      counts.contextClose += 1
      return closeContext()
    },
  }
  const adapter = createRuntimeAdapter({
    operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt',
    audioPath: 'private-audio-path',
    locale: 'en-US',
    ffplayPath: 'private-player-path',
    lockClass: 'held_by_parent',
    initialContext: context,
    initialPage: page,
  })
  return { adapter, counts, privateWindow }
}

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

const operatorIdentity = ({
  pid,
  startTicks = '638000000000000000',
  anchorPid = pid,
  anchorStartTicks = startTicks,
}) => ({ pid, startTicks, anchorPid, anchorStartTicks })

const ownedIdentityOutput = (pid, anchorPid = pid) => {
  const ticks = toDotNetTicks(fixtureStart)
  return `owned:${pid}:${ticks}:${anchorPid}:${ticks}`
}

const inspectEncodedIdentity = async (output) => {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.kill = () => true
  const inspection = inspectOperatorServerOwner(null, {
    spawnOwnerHelper: () => {
      setImmediate(() => {
        child.stdout.emit('data', Buffer.from(output))
        child.emit('close', 0)
      })
      return child
    },
    inspectionTimeoutMs: 50,
    terminationStepMs: 5,
  })
  return inspection
}

const nextDevCommand = ({
  root = fixtureAitRoot,
  host = '127.0.0.1',
  port = 3000,
  optionStyle = 'short',
  moduleStyle = 'direct',
  quoteModule = false,
  suffix = '',
} = {}) => {
  const modulePath =
    moduleStyle === 'npm-shim'
      ? `${root}\\node_modules\\.bin\\\\..\\next\\dist\\bin\\next`
      : `${root}\\node_modules\\next\\dist\\bin\\next`
  return `${quoteModule ? `"${modulePath}"` : modulePath} dev ${
    optionStyle === 'long' ? '--hostname' : '-H'
  } ${host} ${optionStyle === 'long' ? '--port' : '-p'} ${port}${suffix}`
}

const nextChildCommand = ({
  root = fixtureAitRoot,
  module = 'start-server.js',
} = {}) =>
  `${root}\\node_modules\\next\\dist\\server\\lib\\${module}`

const createFakeAdapter = ({
  outcomeClass = 'final_result',
  recognitionDrainClass = 'drain_elapsed',
  playerExitClass = 'exit_zero',
  stabilityClass = 'stable_positive',
  acquireError = null,
  startServerBarrier = null,
  startPlaybackBarrier = null,
  cleanupErrorAt = null,
  localeError = null,
  playerRemainsAlive = false,
  externalRevalidateError = null,
  externalRevalidateErrorAt = null,
  acceptedCompletionError = null,
  finalDelta = 1,
} = {}) => {
  const events = []
  let resultCount = 0
  let finalCount = 0
  let attempts = 0
  let externalRevalidateCount = 0
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
      externalRevalidateCount += 1
      events.push('external-server-revalidated')
      if (
        externalRevalidateError &&
        (externalRevalidateErrorAt === null ||
          externalRevalidateCount === externalRevalidateErrorAt)
      ) {
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
    async waitForPlaybackCompletion() {
      events.push('playback-complete')
      return { exitClass: playerExitClass }
    },
    async finalizeRecognitionInput() {
      events.push('recognition-finalize')
    },
    async waitForRecognitionDrain({ timeoutMs }) {
      assert.equal(timeoutMs, RECOGNITION_DRAIN_TIMEOUT_MS)
      events.push(`recognition-drain-${recognitionDrainClass}`)
      if (recognitionDrainClass === 'final_result') {
        resultCount += finalDelta
        finalCount += finalDelta
      }
      return { class: recognitionDrainClass }
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
        resultCount += finalDelta
        finalCount += finalDelta
      }
      return { class: outcomeClass }
    },
    async recordFinalResult() {
      events.push('record-final')
    },
    async waitForAcceptedCandidateCompletion() {
      events.push('accepted-candidate-completed')
      if (acceptedCompletionError) {
        throw new ControllerError(acceptedCompletionError)
      }
    },
    async assertIntegratedCardinality() {
      events.push('integrated-cardinality-verified')
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

  const serverStartIndex = adapter.events.indexOf('server-start')
  const browserLaunchIndex = adapter.events.indexOf('browser-launch')
  const audioInputIndex = adapter.events.indexOf('audio-input-live')
  const initialRevalidationIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'external-server-revalidated')
    .map(([, index]) => index)
  assert.ok(serverStartIndex < initialRevalidationIndexes[0])
  assert.ok(initialRevalidationIndexes[0] < browserLaunchIndex)
  assert.ok(browserLaunchIndex < initialRevalidationIndexes[1])
  assert.ok(initialRevalidationIndexes[1] < audioInputIndex)

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
    adapter.events.filter((event) => event === 'playback-complete').length,
    ATTEMPT_COUNT
  )
  assert.equal(
    adapter.events.filter((event) => event === 'recognition-finalize').length,
    ATTEMPT_COUNT
  )
  const playbackCompleteIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'playback-complete')
    .map(([, index]) => index)
  const finalizeIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'recognition-finalize')
    .map(([, index]) => index)
  const outcomeIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'outcome-final_result')
    .map(([, index]) => index)
  const playbackStopIndexes = adapter.events
    .map((event, index) => [event, index])
    .filter(([event]) => event === 'playback-stop')
    .map(([, index]) => index)
  for (let index = 0; index < ATTEMPT_COUNT; index += 1) {
    assert.ok(playbackCompleteIndexes[index] < finalizeIndexes[index])
    assert.ok(finalizeIndexes[index] < outcomeIndexes[index])
    assert.ok(outcomeIndexes[index] < playbackStopIndexes[index])
  }
  assert.equal(
    adapter.events.some((event) => event.startsWith('recognition-drain-')),
    false
  )
  assert.equal(
    adapter.events.filter((event) => event === 'locale-verified').length,
    ATTEMPT_COUNT
  )
  assert.equal(
    adapter.events.filter(
      (event) => event === 'external-server-revalidated'
    ).length,
    ATTEMPT_COUNT + 2
  )
  assert.deepEqual(adapter.events.slice(-5), [
    'recognition-stop',
    'browser-close',
    'server-stop',
    'temp-delete',
    'release-lock',
  ])
})

test('keeps recognition open for the bounded drain and preserves an early final', async () => {
  const adapter = createFakeAdapter({
    recognitionDrainClass: 'final_result',
    outcomeClass: 'attempt_timeout',
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    attemptCount: INTEGRATED_ATTEMPT_COUNT,
    audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
    integratedPresentation: true,
  })

  assert.equal(result.controller_status, 'completed')
  assert.equal(result.final_result_count, 1)
  assert.equal(adapter.events.includes('outcome-attempt_timeout'), false)
  assert.ok(
    adapter.events.indexOf('playback-complete') <
      adapter.events.indexOf('recognition-drain-final_result')
  )
  assert.ok(
    adapter.events.indexOf('recognition-drain-final_result') <
      adapter.events.indexOf('recognition-finalize')
  )
})

test('real adapter drain waits only for a new final and maps timeout to elapsed', async () => {
  const observations = []
  let timeoutMode = false
  const page = {
    async waitForFunction(predicate, beforeFinalCount, options) {
      observations.push({ beforeFinalCount, timeoutMs: options.timeout })
      const previousWindow = globalThis.window
      try {
        globalThis.window = {
          __preparedSampleSttCounts: {
            resultCount: beforeFinalCount,
            finalCount: beforeFinalCount,
          },
        }
        assert.equal(predicate(beforeFinalCount), false)
        globalThis.window.__preparedSampleSttCounts.resultCount += 1
        assert.equal(predicate(beforeFinalCount), false)
        globalThis.window.__preparedSampleSttCounts.finalCount += 1
        assert.equal(predicate(beforeFinalCount), true)
      } finally {
        if (previousWindow === undefined) delete globalThis.window
        else globalThis.window = previousWindow
      }
      if (timeoutMode) throw new Error('timeout')
    },
  }
  const adapter = createRuntimeAdapter({
    operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt/',
    audioPath: 'private-not-read-by-drain',
    locale: 'ja-JP',
    ffplayPath: '',
    lockClass: 'held_by_parent',
    initialPage: page,
  })

  assert.deepEqual(
    await adapter.waitForRecognitionDrain({
      beforeFinalCount: 4,
      timeoutMs: RECOGNITION_DRAIN_TIMEOUT_MS,
    }),
    { class: 'final_result' }
  )
  timeoutMode = true
  assert.deepEqual(
    await adapter.waitForRecognitionDrain({
      beforeFinalCount: 9,
      timeoutMs: RECOGNITION_DRAIN_TIMEOUT_MS,
    }),
    { class: 'drain_elapsed' }
  )
  assert.deepEqual(observations, [
    { beforeFinalCount: 4, timeoutMs: RECOGNITION_DRAIN_TIMEOUT_MS },
    { beforeFinalCount: 9, timeoutMs: RECOGNITION_DRAIN_TIMEOUT_MS },
  ])
})

test('integrated route runs once and waits for accepted submission before cleanup', async () => {
  const adapter = createFakeAdapter()
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    attemptCount: INTEGRATED_ATTEMPT_COUNT,
    audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
    integratedPresentation: true,
  })

  assert.equal(result.controller_status, 'completed')
  assert.equal(result.controller_stop_signal, 'completed_exactly_one_attempt')
  assert.equal(result.attempt_count, 1)
  assert.equal(result.playback_start_count, 1)
  assert.equal(result.playback_exit_zero_count, 1)
  assert.equal(result.final_result_count, 1)
  assert.equal(result.content_match_stability_class, 'bounded_attempt_set_positive')
  assert.equal(
    adapter.events.filter(
      (event) => event === 'recognition-drain-drain_elapsed'
    ).length,
    1
  )
  assert.equal(
    adapter.events.filter((event) => event === 'accepted-candidate-completed')
      .length,
    1
  )
  assert.ok(
    adapter.events.indexOf('accepted-candidate-completed') <
      adapter.events.indexOf('browser-close')
  )
  assert.ok(
    adapter.events.indexOf('integrated-cardinality-verified') <
      adapter.events.indexOf('browser-close')
  )
})

test('integrated route fails closed when accepted submission does not complete', async () => {
  const adapter = createFakeAdapter({
    acceptedCompletionError: 'accepted_candidate_request_not_completed',
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    attemptCount: 1,
    audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
    integratedPresentation: true,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'accepted_candidate_request_not_completed')
  assert.ok(
    adapter.events.indexOf('accepted-candidate-completed') <
      adapter.events.indexOf('browser-close')
  )
})

test('rejects duplicate final activity and converges cleanup', async () => {
  const adapter = createFakeAdapter({ finalDelta: 2 })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    attemptCount: 1,
    audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
    integratedPresentation: true,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'duplicate_final_or_playback_rejected')
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

test('rejects an owner swap after browser handshake and before audio permission work', async () => {
  const adapter = createFakeAdapter({
    externalRevalidateError: 'operator_server_collision',
    externalRevalidateErrorAt: 2,
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'operator_server_collision')
  assert.equal(adapter.events.includes('browser-launch'), true)
  assert.equal(adapter.events.includes('audio-input-live'), false)
  assert.equal(adapter.events.includes('fill-private-text'), false)
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
  const identity = operatorIdentity({ pid: 42 })
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
      probeAttempts: 1,
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

test('waits for a cold exact external operator surface without changing ownership', async () => {
  const operatorUrl =
    'http://127.0.0.1:3000/operator/prepared-sample-stt'
  const identity = operatorIdentity({ pid: 42 })
  const probeResults = [false, false, true]
  let ownerInspectionCount = 0
  let retrySleepCount = 0

  assert.deepEqual(
    await resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => {
        ownerInspectionCount += 1
        return identity
      },
      probe: async () => probeResults.shift() ?? false,
      operatorUrl,
      probeAttempts: 3,
      probeDelayMs: 1,
      sleepForRetry: async () => {
        retrySleepCount += 1
      },
    }),
    { serverMode: 'attach_external', externalServerIdentity: identity }
  )
  assert.equal(ownerInspectionCount, 4)
  assert.equal(retrySleepCount, 2)
})

test('accepts a cold direct-owner to sealed-listener handoff under one stable Next lineage', async () => {
  const directIdentity = operatorIdentity({ pid: 42 })
  const sealedIdentityA = operatorIdentity({
    pid: 43,
    startTicks: '638000000000000100',
    anchorPid: 42,
    anchorStartTicks: directIdentity.anchorStartTicks,
  })
  const sealedIdentityB = operatorIdentity({
    pid: 44,
    startTicks: '638000000000000200',
    anchorPid: 42,
    anchorStartTicks: directIdentity.anchorStartTicks,
  })
  const identities = [
    directIdentity,
    sealedIdentityA,
    sealedIdentityB,
    sealedIdentityB,
  ]
  const probeResults = [false, false, true]

  const resolution = await resolveOperatorServerMode({
    canBind: async () => false,
    inspectOwner: async () => identities.shift(),
    probe: async () => probeResults.shift(),
    operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt',
    probeAttempts: 3,
    probeDelayMs: 1,
    sleepForRetry: async () => {},
  })

  assert.deepEqual(resolution, {
    serverMode: 'attach_external',
    externalServerIdentity: directIdentity,
  })
})

test('rejects a listener handoff when the exact Next lineage anchor changes', async () => {
  const initial = operatorIdentity({ pid: 42 })
  const changedAnchors = [
    operatorIdentity({
      pid: 43,
      startTicks: '638000000000000100',
      anchorPid: 41,
      anchorStartTicks: initial.anchorStartTicks,
    }),
    operatorIdentity({
      pid: 43,
      startTicks: '638000000000000100',
      anchorPid: initial.anchorPid,
      anchorStartTicks: '638000000000000200',
    }),
  ]

  for (const changedAnchor of changedAnchors) {
    const identities = [initial, changedAnchor]
    await assert.rejects(
      resolveOperatorServerMode({
        canBind: async () => false,
        inspectOwner: async () => identities.shift(),
        probe: async () => true,
        operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt',
      }),
      (error) =>
        error instanceof ControllerError &&
        error.resultClass === 'operator_server_collision'
    )
  }
})

test('fails closed if an external operator owner changes while its surface is cold', async () => {
  const identities = [
    operatorIdentity({ pid: 42 }),
    operatorIdentity({
      pid: 43,
      startTicks: '638000000000000100',
      anchorStartTicks: '638000000000000100',
    }),
  ]
  let retrySleepCount = 0

  await assert.rejects(
    resolveOperatorServerMode({
      canBind: async () => false,
      inspectOwner: async () => identities.shift() ?? null,
      probe: async () => false,
      operatorUrl:
        'http://127.0.0.1:3000/operator/prepared-sample-stt',
      probeAttempts: 3,
      sleepForRetry: async () => {
        retrySleepCount += 1
      },
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'operator_server_collision'
  )
  assert.equal(retrySleepCount, 0)
})

test('stops cold-surface retry work when probe, inspection, or delay observes abort', async () => {
  const identity = operatorIdentity({ pid: 42 })
  for (const abortAt of ['probe', 'inspection', 'delay']) {
    const controller = new AbortController()
    const timeoutError = new ControllerError('whole_route_timeout')
    let probeCount = 0
    let inspectCount = 0
    let sleepCount = 0
    await assert.rejects(
      resolveOperatorServerMode({
        canBind: async () => false,
        inspectOwner: async (signal) => {
          assert.equal(signal, controller.signal)
          inspectCount += 1
          if (abortAt === 'inspection' && inspectCount === 2) {
            controller.abort(timeoutError)
          }
          return identity
        },
        probe: async (_url, signal) => {
          assert.equal(signal, controller.signal)
          probeCount += 1
          if (abortAt === 'probe') controller.abort(timeoutError)
          return false
        },
        operatorUrl:
          'http://127.0.0.1:3000/operator/prepared-sample-stt',
        signal: controller.signal,
        probeAttempts: 3,
        probeDelayMs: 1,
        sleepForRetry: async (_delayMs, signal) => {
          assert.equal(signal, controller.signal)
          sleepCount += 1
          if (abortAt === 'delay') controller.abort(timeoutError)
        },
      }),
      (error) => error === timeoutError,
      abortAt
    )
    assert.equal(probeCount, 1, abortAt)
    assert.equal(inspectCount, 1 + (abortAt === 'probe' ? 0 : 1), abortAt)
    assert.equal(sleepCount, abortAt === 'delay' ? 1 : 0, abortAt)
  }
})

test('waits for the exact owner helper to exit after cancellation', async () => {
  const controller = new AbortController()
  const timeoutError = new ControllerError('whole_route_timeout')
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.killCalls = []
  child.kill = (signal = 'SIGTERM') => {
    child.killCalls.push(signal)
    setImmediate(() => child.emit('close', null))
    return true
  }
  const inspection = inspectOperatorServerOwner(controller.signal, {
    spawnOwnerHelper: () => child,
    inspectionTimeoutMs: 50,
    terminationStepMs: 10,
  })
  controller.abort(timeoutError)
  await assert.rejects(inspection, (error) => error === timeoutError)
  assert.deepEqual(child.killCalls, ['SIGTERM'])
})

test('reports cleanup incomplete if an exact owner helper cannot be terminated', async () => {
  const controller = new AbortController()
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.killCalls = []
  child.kill = (signal = 'SIGTERM') => {
    child.killCalls.push(signal)
    return true
  }
  const inspection = inspectOperatorServerOwner(controller.signal, {
    spawnOwnerHelper: () => child,
    inspectionTimeoutMs: 50,
    terminationStepMs: 5,
  })
  controller.abort(new ControllerError('whole_route_timeout'))
  await assert.rejects(
    inspection,
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'cleanup_incomplete'
  )
  assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL'])
})

test('does not treat kill errors as close-confirmed owner-helper termination', async () => {
  for (const stopClass of ['aborted', 'timed_out']) {
    const controller = stopClass === 'aborted' ? new AbortController() : null
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.killCalls = []
    child.kill = (signal = 'SIGTERM') => {
      child.killCalls.push(signal)
      setImmediate(() => child.emit('error', new Error('fixed-test-error')))
      return false
    }
    const inspection = inspectOperatorServerOwner(controller?.signal ?? null, {
      spawnOwnerHelper: () => child,
      inspectionTimeoutMs: 5,
      terminationStepMs: 5,
    })
    if (controller) {
      controller.abort(new ControllerError('whole_route_timeout'))
    }
    await assert.rejects(
      inspection,
      (error) =>
        error instanceof ControllerError &&
        error.resultClass === 'cleanup_incomplete',
      stopClass
    )
    assert.deepEqual(child.killCalls, ['SIGTERM', 'SIGKILL'], stopClass)
  }
})

test('rejects an external operator owner swap after SSR probing', async () => {
  const identities = [
    operatorIdentity({ pid: 42 }),
    operatorIdentity({
      pid: 43,
      startTicks: '638000000000000100',
      anchorStartTicks: '638000000000000100',
    }),
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
  assert.match(script, /Test-ExactNextChildCommand/)
  assert.match(script, /node_modules\\next\\dist\\server\\lib\\start-server/)
  assert.match(script, /GetFullPath/)
  assert.match(script, /\$moduleOwned=/)
  assert.match(script, /-H\|--hostname/)
  assert.match(script, /-p\|--port/)
  assert.match(script, /hostFlags\.Count -eq 1/)
  assert.match(script, /portFlags\.Count -eq 1/)
  assert.match(script, /\$owned=\$directOwned -or \$sealedChild/)
  assert.match(script, /\$anchor=if\(\$directOwned\)/)
  assert.match(script, /\$anchorTicks=/)
})

test('classifies direct and sealed-child Next ownership behaviorally', () => {
  const directOwner = processFixture({
    processId: 99,
    commandLine: nextDevCommand(),
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [directOwner],
    }),
    ownedIdentityOutput(99)
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

  const quotedCanonicalCommand = nextDevCommand({
    optionStyle: 'long',
    moduleStyle: 'npm-shim',
    quoteModule: true,
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({ processId: 99, commandLine: quotedCanonicalCommand }),
      ],
    }),
    ownedIdentityOutput(99)
  )
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [
        exactChild,
        processFixture({ processId: 55, commandLine: quotedCanonicalCommand }),
      ],
    }),
    ownedIdentityOutput(99, 55)
  )

  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [exactChild, exactParent],
    }),
    ownedIdentityOutput(99, 55)
  )

  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: `"C:\\Program Files\\nodejs\\node.exe" ${nextChildCommand()}`,
        }),
        exactParent,
      ],
    }),
    ownedIdentityOutput(99, 55)
  )

  const canonicalParent = processFixture({
    processId: 55,
    commandLine: nextDevCommand({
      optionStyle: 'long',
      moduleStyle: 'npm-shim',
    }),
  })
  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [exactChild, canonicalParent],
    }),
    ownedIdentityOutput(99, 55)
  )

  assert.equal(
    runOwnerInspectionFixture({
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          commandLine: nextDevCommand({
            optionStyle: 'long',
            moduleStyle: 'npm-shim',
          }),
        }),
      ],
    }),
    ownedIdentityOutput(99)
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
      name: 'child module suffix decoy',
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: nextChildCommand({ module: 'start-server-evil.js' }),
        }),
        exactParent,
      ],
    },
    {
      name: 'child module prefix decoy',
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: nextChildCommand({ module: 'evil-start-server.js' }),
        }),
        exactParent,
      ],
    },
    {
      name: 'canonical child path as unrelated argument',
      listeners: [listenerFixture(99)],
      processes: [
        processFixture({
          processId: 99,
          parentProcessId: 55,
          commandLine: `${fixtureAitRoot}\\unrelated.js ${nextChildCommand()}`,
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
    {
      name: 'missing dev token',
      commandLine: `${nextBin} -H 127.0.0.1 -p 3000`,
    },
    {
      name: 'duplicate dev token',
      commandLine: `${nextBin} dev dev -H 127.0.0.1 -p 3000`,
    },
    {
      name: 'noncanonical dev case',
      commandLine: `${nextBin} DEV -H 127.0.0.1 -p 3000`,
    },
    {
      name: 'exact module decoy before wrong immediate module',
      commandLine: `${nextBin} ${fixtureAitRoot}\\scripts\\other.js dev -H 127.0.0.1 -p 3000`,
    },
    {
      name: 'wrong module under exact root',
      commandLine: `${fixtureAitRoot}\\scripts\\other.js dev -H 127.0.0.1 -p 3000`,
    },
    {
      name: 'different package through npm shim traversal',
      commandLine: `${fixtureAitRoot}\\node_modules\\.bin\\\\..\\other\\dist\\bin\\next dev -H 127.0.0.1 -p 3000`,
    },
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

test('parses only positive bounded complete operator lineage identities', async () => {
  const ticks = toDotNetTicks(fixtureStart)
  assert.deepEqual(
    await inspectEncodedIdentity(`owned:99:${ticks}:55:${ticks}`),
    operatorIdentity({
      pid: 99,
      startTicks: ticks,
      anchorPid: 55,
      anchorStartTicks: ticks,
    })
  )

  for (const output of [
    `owned:99:${ticks}`,
    `owned:99:0:55:${ticks}`,
    `owned:99:${ticks}:55:0`,
    'owned:99:3155378976000000000:55:638000000000000000',
    'owned:99:638000000000000000:55:3155378976000000000',
    `owned:99:${ticks}:55:not-a-tick`,
  ]) {
    assert.equal(await inspectEncodedIdentity(output), null, output)
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

test('preserves cleanup incomplete when a timed-out route cannot terminate its exact helper', async () => {
  const adapter = createFakeAdapter({
    startServerBarrier: new Promise((_, reject) =>
      setTimeout(() => reject(new ControllerError('cleanup_incomplete')), 10)
    ),
  })
  const result = await runPreparedSampleController({
    adapter,
    expectedText: privateExpectedText,
    routeTimeoutMs: 5,
    routeCancelSettleMs: 20,
  })

  assert.equal(result.controller_status, 'error')
  assert.equal(result.blocker_class, 'cleanup_incomplete')
  assert.equal(result.cleanup_class, 'cleanup_incomplete')
  assert.equal(result.controller_stop_signal, 'stopped_on_cleanup_incomplete')
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

test('accepts a signal-terminated owned server as stopped', async () => {
  const ownedChild = {
    exitCode: null,
    signalCode: null,
    killCalls: [],
    kill(signal) {
      this.killCalls.push(signal ?? 'graceful')
      this.signalCode = signal ?? 'SIGTERM'
    },
  }

  const stopped = await stopTrackedServer({
    serverMode: 'start_owned',
    serverChild: ownedChild,
    waitForExit: async () => null,
  })

  assert.deepEqual(stopped, { serverMode: 'none', serverChild: null })
  assert.deepEqual(ownedChild.killCalls, ['graceful'])
  assert.equal(ownedChild.signalCode, 'SIGTERM')
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

test('classifies exactly one fixed virtual capture/render pair and rejects zero or ambiguity', () => {
  const capture = {
    kind: 'audioinput',
    label: 'CABLE Output (VB-Audio Virtual Cable)',
    deviceId: 'PRIVATE_CAPTURE_ID',
  }
  const render = {
    kind: 'audiooutput',
    label: 'CABLE Input (VB-Audio Virtual Cable)',
    deviceId: 'PRIVATE_RENDER_ID',
  }
  assert.deepEqual(classifyFixedAudioEndpointSelection([capture, render]), {
    captureMatchCount: 1,
    renderMatchCount: 1,
    exactPairSelected: true,
  })
  for (const devices of [[], [capture, { ...capture }], [render, { ...render }]]) {
    const classification = classifyFixedAudioEndpointSelection(devices)
    assert.equal(classification.exactPairSelected, false)
    assert.throws(
      () =>
        requireBrowserAudioAvailability({
          permissionAvailable: true,
          live: true,
          explicitDeviceSelected: true,
          inputCount: Math.max(1, classification.captureMatchCount),
          outputCount: Math.max(1, classification.renderMatchCount),
          audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
          ...classification,
          sinkSelectionAvailable: true,
        }),
      (error) =>
        error instanceof ControllerError &&
        error.resultClass === 'browser_audio_route_unavailable_or_ambiguous'
    )
  }
  assert.equal(
    JSON.stringify(classifyFixedAudioEndpointSelection([capture, render])).includes(
      'PRIVATE_'
    ),
    false
  )
})

test('selects the exact virtual input live after permission and releases every track', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAudioContext = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioContext'
  )
  const calls = []
  const stops = { exact: 0 }
  const exactTrack = {
    kind: 'audio',
    readyState: 'live',
    getSettings: () => ({ deviceId: 'PRIVATE_CAPTURE_ID' }),
    stop: () => {
      stops.exact += 1
    },
  }
  const streamFor = (track) => ({
    getTracks: () => [track],
    getAudioTracks: () => [track],
  })
  class SinkAudioContext {}
  SinkAudioContext.prototype.setSinkId = async () => {}
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(constraints) {
          calls.push(constraints)
          return streamFor(exactTrack)
        },
        async enumerateDevices() {
          return [
            {
              kind: 'audioinput',
              label: 'CABLE Output (VB-Audio Virtual Cable)',
              deviceId: 'PRIVATE_CAPTURE_ID',
            },
            {
              kind: 'audiooutput',
              label: 'CABLE Input (VB-Audio Virtual Cable)',
              deviceId: 'PRIVATE_RENDER_ID',
            },
          ]
        },
      },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: SinkAudioContext,
  })

  try {
    const result = await selectBrowserAudioRoute(
      AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
    )
    requireBrowserAudioAvailability(result)
    assert.deepEqual(stops, { exact: 1 })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].audio.deviceId.exact, 'PRIVATE_CAPTURE_ID')
    assert.equal(calls[0].audio.echoCancellation.exact, false)
    assert.equal(result.live, true)
    assert.equal(result.exactPairSelected, undefined)
    assert.equal(JSON.stringify(result).includes('PRIVATE_'), false)
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, 'navigator', originalNavigator)
    } else delete globalThis.navigator
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    if (originalAudioContext) {
      Object.defineProperty(globalThis, 'AudioContext', originalAudioContext)
    } else delete globalThis.AudioContext
  }
})

test('browser routed playback selects sink before play, applies +12 dB, and releases handles', async () => {
  const originals = new Map(
    ['window', 'Audio', 'AudioContext', 'fetch'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  )
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL
  const events = []
  let gainValue = null
  let revoked = 0
  class FakeAudio {
    addEventListener() {}
    removeAttribute() {}
    load() {}
    pause() {
      events.push('pause')
    }
    async play() {
      events.push('play')
    }
  }
  class FakeAudioContext {
    constructor() {
      this.currentTime = 0
      this.destination = {}
    }
    async setSinkId(value) {
      assert.equal(value, 'PRIVATE_RENDER_ID')
      events.push('sink')
    }
    createMediaElementSource() {
      return { connect: () => ({ connect: () => {} }), disconnect() {} }
    }
    createGain() {
      return {
        gain: {
          setValueAtTime(value) {
            gainValue = value
          },
        },
        connect: () => ({}),
        disconnect() {},
      }
    }
    async resume() {
      events.push('resume')
    }
    async close() {
      events.push('close')
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __preparedSampleSttAudioOutputDeviceId: 'PRIVATE_RENDER_ID' },
  })
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: FakeAudio,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  })
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async () => ({ ok: true, blob: async () => ({ size: 128 }) }),
  })
  URL.createObjectURL = () => 'blob:fixed-route'
  URL.revokeObjectURL = () => {
    revoked += 1
  }
  try {
    await startBrowserRoutedPlayback({
      audioUrl: 'http://127.0.0.1/fixed',
      maximumBytes: 256,
      gainLinear: BROWSER_PLAYBACK_GAIN_LINEAR,
    })
    assert.equal(events.filter((event) => event === 'sink').length, 1)
    assert.equal(events.filter((event) => event === 'play').length, 1)
    assert.notEqual(events.indexOf('sink'), -1)
    assert.notEqual(events.indexOf('play'), -1)
    assert.ok(events.indexOf('sink') < events.indexOf('play'))
    assert.equal(BROWSER_PLAYBACK_GAIN_DB, 12)
    assert.ok(Math.abs(gainValue - 10 ** (12 / 20)) < 1e-12)
    await assert.rejects(
      startBrowserRoutedPlayback({
        audioUrl: 'http://127.0.0.1/fixed',
        maximumBytes: 256,
        gainLinear: BROWSER_PLAYBACK_GAIN_LINEAR,
      }),
      /duplicate_final_or_playback_rejected/
    )
    await releaseBrowserRoutedPlayback()
    assert.equal(revoked, 1)
    assert.equal(events.filter((event) => event === 'close').length, 1)
    assert.equal(Object.hasOwn(globalThis.window, '__preparedSampleBrowserRoutedPlayer'), false)
  } finally {
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('browser routed playback fails fixed-class when setSinkId is missing', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, 'Audio')
  const originalAudioContext = Object.getOwnPropertyDescriptor(
    globalThis,
    'AudioContext'
  )
  class FakeAudio {
    pause() {}
    removeAttribute() {}
    load() {}
  }
  class MissingSinkAudioContext {
    async close() {}
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __preparedSampleSttAudioOutputDeviceId: 'PRIVATE_RENDER_ID' },
  })
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: FakeAudio,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: MissingSinkAudioContext,
  })
  try {
    await assert.rejects(
      startBrowserRoutedPlayback({
        audioUrl: 'http://127.0.0.1/fixed',
        maximumBytes: 256,
        gainLinear: BROWSER_PLAYBACK_GAIN_LINEAR,
      }),
      /browser_audio_output_sink_unavailable/
    )
    assert.equal(Object.hasOwn(globalThis.window, '__preparedSampleBrowserRoutedPlayer'), false)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    if (originalAudio) Object.defineProperty(globalThis, 'Audio', originalAudio)
    else delete globalThis.Audio
    if (originalAudioContext) {
      Object.defineProperty(globalThis, 'AudioContext', originalAudioContext)
    } else delete globalThis.AudioContext
  }
})

test('browser routed playback fixes sink rejection and closes the context', async () => {
  const originals = new Map(
    ['window', 'Audio', 'AudioContext'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  )
  const privateMarker = 'PRIVATE_SINK native-cause native-stack'
  const counts = { sink: 0, pause: 0, close: 0 }
  class FakeAudio {
    pause() {
      counts.pause += 1
    }
    removeAttribute() {}
    load() {}
  }
  class RejectingSinkAudioContext {
    async setSinkId() {
      counts.sink += 1
      throw new Error(privateMarker)
    }
    async close() {
      counts.close += 1
    }
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __preparedSampleSttAudioOutputDeviceId: 'PRIVATE_RENDER_ID' },
  })
  Object.defineProperty(globalThis, 'Audio', {
    configurable: true,
    value: FakeAudio,
  })
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: RejectingSinkAudioContext,
  })
  try {
    await assert.rejects(
      startBrowserRoutedPlayback({
        audioUrl: 'http://127.0.0.1/fixed',
        maximumBytes: 256,
        gainLinear: BROWSER_PLAYBACK_GAIN_LINEAR,
      }),
      (error) => {
        assert.equal(error.message, 'browser_audio_output_sink_selection_failed')
        assert.equal(String(error).includes(privateMarker), false)
        return true
      }
    )
    assert.deepEqual(counts, { sink: 1, pause: 1, close: 1 })
    assert.equal(
      Object.hasOwn(globalThis.window, '__preparedSampleBrowserRoutedPlayer'),
      false
    )
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})

test('accepted candidate completion barrier rejects failed duplicate and timeout states', async () => {
  const createPage = (state, { timeout = false } = {}) => ({
    async waitForFunction(predicate) {
      if (timeout) throw new Error('PRIVATE_TIMEOUT')
      const originalWindow = globalThis.window
      globalThis.window = { __preparedSampleAtomicAttemptState: state }
      try {
        if (!predicate()) throw new Error('predicate_not_met')
      } finally {
        if (originalWindow === undefined) delete globalThis.window
        else globalThis.window = originalWindow
      }
    },
    async evaluate(operation) {
      const originalWindow = globalThis.window
      globalThis.window = { __preparedSampleAtomicAttemptState: state }
      try {
        return operation()
      } finally {
        if (originalWindow === undefined) delete globalThis.window
        else globalThis.window = originalWindow
      }
    },
  })
  const completed = await waitForAcceptedCandidateCompletion({
    page: createPage({
      acceptedRequestCompletedCount: 1,
      acceptedRequestFailedCount: 0,
      duplicateRejectedCount: 0,
    }),
    timeoutMs: 100,
  })
  assert.deepEqual(completed, {
    class: 'accepted_candidate_request_completed',
  })
  for (const [state, blockerClass] of [
    [
      {
        acceptedRequestCompletedCount: 0,
        acceptedRequestFailedCount: 1,
        duplicateRejectedCount: 0,
      },
      'accepted_candidate_request_not_completed',
    ],
    [
      {
        acceptedRequestCompletedCount: 1,
        acceptedRequestFailedCount: 0,
        duplicateRejectedCount: 1,
      },
      'duplicate_final_or_playback_rejected',
    ],
    [
      {
        acceptedRequestCompletedCount: 2,
        acceptedRequestFailedCount: 0,
        duplicateRejectedCount: 0,
      },
      'accepted_candidate_request_not_completed',
    ],
  ]) {
    await assert.rejects(
      waitForAcceptedCandidateCompletion({
        page: createPage(state),
        timeoutMs: 100,
      }),
      (error) =>
        error instanceof ControllerError && error.resultClass === blockerClass
    )
  }
  await assert.rejects(
    waitForAcceptedCandidateCompletion({
      page: createPage({}, { timeout: true }),
      timeoutMs: 100,
    }),
    (error) =>
      error instanceof ControllerError &&
      error.resultClass === 'accepted_candidate_request_not_completed'
  )
})

test('preflight stops every unique acquired track and fixes stop failures', async () => {
  const privateMarker =
    'PRIVATE_TRACK C:\\private\\preflight.wav native-cause native-stack'
  const stopCounts = { failing: 0, healthy: 0 }
  const failingTrack = {
    kind: 'audio',
    readyState: 'live',
    getSettings() {
      return { deviceId: 'private-audio-input-device-id' }
    },
    stop() {
      stopCounts.failing += 1
      throw new Error(privateMarker)
    },
  }
  const healthyTrack = {
    kind: 'video',
    readyState: 'live',
    stop() {
      stopCounts.healthy += 1
    },
  }
  const privateWindow = {}
  const privateNavigator = {
    mediaDevices: {
      async getUserMedia() {
        return {
          getTracks: () => [failingTrack, healthyTrack, failingTrack],
          getAudioTracks: () => [failingTrack],
        }
      },
      async enumerateDevices() {
        return [{ kind: 'audioinput' }, { kind: 'audiooutput' }]
      },
    },
  }
  const page = {
    async evaluate(operation) {
      const navigatorDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'navigator'
      )
      const windowDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'window'
      )
      Object.defineProperty(globalThis, 'navigator', {
        value: privateNavigator,
        configurable: true,
      })
      Object.defineProperty(globalThis, 'window', {
        value: privateWindow,
        configurable: true,
      })
      try {
        return await operation()
      } finally {
        if (navigatorDescriptor) {
          Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
        } else {
          delete globalThis.navigator
        }
        if (windowDescriptor) {
          Object.defineProperty(globalThis, 'window', windowDescriptor)
        } else {
          delete globalThis.window
        }
      }
    },
  }
  const adapter = createRuntimeAdapter({
    operatorUrl: 'http://127.0.0.1:3000/operator/prepared-sample-stt',
    audioPath: 'private-audio-path',
    locale: 'en-US',
    ffplayPath: 'private-player-path',
    lockClass: 'held_by_parent',
    initialPage: page,
  })

  await assert.rejects(adapter.requireLiveAudioInput(), (error) => {
    assert.equal(error instanceof ControllerError, true)
    assert.equal(error.resultClass, 'cleanup_incomplete')
    assert.equal(error.message, 'cleanup_incomplete')
    assert.equal(String(error).includes(privateMarker), false)
    return true
  })
  assert.deepEqual(stopCounts, { failing: 1, healthy: 1 })
})

test('closeBrowser continues through page release failure and clears owned refs', async () => {
  const privateMarker =
    'PRIVATE_DEVICE C:\\private\\cleanup.wav native-cause native-stack'
  const { adapter, counts, privateWindow } = createBrowserCleanupFixture({
    privateMarker,
    releaseTrack() {
      throw new Error(privateMarker)
    },
    closeContext() {},
  })

  await assert.rejects(adapter.closeBrowser(), (error) => {
    assert.equal(error instanceof ControllerError, true)
    assert.equal(error.resultClass, 'cleanup_incomplete')
    assert.equal(error.message, 'cleanup_incomplete')
    assert.equal(String(error).includes(privateMarker), false)
    return true
  })
  assert.deepEqual(counts, {
    evaluate: 2,
    release: 1,
    routedClose: 1,
    contextClose: 1,
  })
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttReleaseAudioTrack'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttAudioInputDeviceId'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttAudioOutputDeviceId'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleBrowserRoutedPlayer'),
    false
  )

  await adapter.closeBrowser()
  assert.deepEqual(counts, {
    evaluate: 2,
    release: 1,
    routedClose: 1,
    contextClose: 1,
  })
})

test('closeBrowser fixes context close failure and still clears both refs', async () => {
  const privateMarker =
    'PRIVATE_CONTEXT C:\\private\\profile native-cause native-stack'
  const { adapter, counts, privateWindow } = createBrowserCleanupFixture({
    privateMarker,
    releaseTrack() {
      return 'explicit_audio_track_cleanup_complete'
    },
    closeContext() {
      throw new Error(privateMarker)
    },
  })

  await assert.rejects(adapter.closeBrowser(), (error) => {
    assert.equal(error instanceof ControllerError, true)
    assert.equal(error.resultClass, 'cleanup_incomplete')
    assert.equal(error.message, 'cleanup_incomplete')
    assert.equal(String(error).includes(privateMarker), false)
    return true
  })
  assert.deepEqual(counts, {
    evaluate: 2,
    release: 1,
    routedClose: 1,
    contextClose: 1,
  })
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttReleaseAudioTrack'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttAudioInputDeviceId'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleSttAudioOutputDeviceId'),
    false
  )
  assert.equal(
    Object.hasOwn(privateWindow, '__preparedSampleBrowserRoutedPlayer'),
    false
  )

  await adapter.closeBrowser()
  assert.deepEqual(counts, {
    evaluate: 2,
    release: 1,
    routedClose: 1,
    contextClose: 1,
  })
})

test('strips all route-private values from server and browser children', () => {
  const privateEnvironment = {
    SystemRoot: 'C:\\Windows',
    PATH: 'C:\\Windows\\System32',
    PUBLIC_MARKER: 'retained',
    NODE_OPTIONS: '--require PRIVATE_BOOTSTRAP',
    HTTPS_PROXY: 'http://PRIVATE_PROXY',
    API_TOKEN: 'PRIVATE_TOKEN',
    SWORD_PREPARED_SAMPLE_OPERATOR_URL: 'private',
    SWORD_PREPARED_SAMPLE_AUDIO_PATH: 'private',
    SWORD_PREPARED_SAMPLE_EXPECTED_TEXT: 'private',
    SWORD_PREPARED_SAMPLE_LOCALE: 'private',
    SWORD_PREPARED_SAMPLE_FFPLAY_PATH: 'private',
    SWORD_PREPARED_SAMPLE_LOCK_CLASS: 'private',
  }
  const childEnvironment = createPublicChildEnvironment(privateEnvironment)

  assert.equal(childEnvironment.SystemRoot, 'C:\\Windows')
  assert.equal(childEnvironment.PATH, 'C:\\Windows\\System32')
  for (const key of [
    'PUBLIC_MARKER',
    'NODE_OPTIONS',
    'HTTPS_PROXY',
    'API_TOKEN',
  ]) {
    assert.equal(Object.hasOwn(childEnvironment, key), false)
  }
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
      explicitDeviceSelected: true,
      inputCount: 1,
      outputCount: 1,
    })
  )
  for (const [value, blockerClass] of [
    [
      {
        permissionAvailable: false,
        live: false,
        explicitDeviceSelected: false,
        inputCount: 0,
        outputCount: 0,
      },
      'browser_microphone_permission_or_device_unavailable',
    ],
    [
      {
        permissionAvailable: true,
        live: false,
        explicitDeviceSelected: false,
        inputCount: 1,
        outputCount: 1,
      },
      'browser_audio_input_track_not_live',
    ],
    [
      {
        permissionAvailable: true,
        live: true,
        explicitDeviceSelected: false,
        inputCount: 1,
        outputCount: 1,
      },
      'explicit_audio_input_device_required',
    ],
    [
      {
        permissionAvailable: true,
        live: true,
        explicitDeviceSelected: true,
        inputCount: 1,
        outputCount: 0,
      },
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

test('validates default five, integrated one, and invalid attempt counts', () => {
  assert.doesNotThrow(() =>
    validateRouteOptions({
      attemptCount: ATTEMPT_COUNT,
      audioRouteClass: AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
    })
  )
  assert.doesNotThrow(() =>
    validateRouteOptions({
      attemptCount: INTEGRATED_ATTEMPT_COUNT,
      audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
      integratedPresentation: true,
    })
  )
  for (const attemptCount of [0, 6, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        validateRouteOptions({
          attemptCount,
          audioRouteClass: AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
        }),
      (error) =>
        error instanceof ControllerError &&
        error.resultClass ===
          'prepared_sample_playback_controller_configuration_invalid'
    )
  }
  assert.throws(
    () =>
      validateRouteOptions({
        attemptCount: 5,
        audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
        integratedPresentation: true,
      }),
    /prepared_sample_playback_controller_configuration_invalid/
  )
  assert.throws(
    () =>
      validateRouteOptions({
        attemptCount: INTEGRATED_ATTEMPT_COUNT,
        audioRouteClass: AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR,
        integratedPresentation: false,
      }),
    /prepared_sample_playback_controller_configuration_invalid/
  )
})

test('locks route bounds and forbids fake audio-device substitution', async () => {
  assert.equal(ATTEMPT_COUNT, 5)
  assert.equal(ATTEMPT_TIMEOUT_MS, 10_000)
  assert.equal(RECOGNITION_DRAIN_TIMEOUT_MS, 3_000)
  assert.ok(RECOGNITION_DRAIN_TIMEOUT_MS < ATTEMPT_TIMEOUT_MS)
  assert.equal(ROUTE_CANCEL_SETTLE_MS, 2_000)
  assert.equal(ROUTE_TIMEOUT_MS, 90_000)
  assert.equal(EXTERNAL_OPERATOR_SURFACE_PROBE_ATTEMPTS, 8)
  assert.equal(EXTERNAL_OPERATOR_SURFACE_PROBE_DELAY_MS, 250)
  assert.equal(OPERATOR_OWNER_INSPECTION_TIMEOUT_MS, 10_000)
  assert.equal(OPERATOR_OWNER_TERMINATION_STEP_MS, 250)

  const source = await readFile(
    fileURLToPath(
      new URL('./collect-prepared-sample-browser-stt-playback.mjs', import.meta.url)
    ),
    'utf8'
  )
  assert.doesNotMatch(source, /--use-fake-ui-for-media-stream/)
  assert.match(source, /--disable-features=ChromeWideEchoCancellation/)
  assert.match(source, /args:\s*resolveBrowserLaunchArgs\(audioRouteClass\)/)
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
  assert.match(
    source,
    /openCanonicalPresentationPages\([\s\S]{0,1200}revalidateExternalServer\(\{ signal \}\)[\s\S]{0,500}grantPermissions\(\['microphone'\],/
  )
  assert.match(source, /getSettings\?\.\(\)\.deviceId/)
  assert.match(source, /__preparedSampleSttAudioInputDeviceId/)
  assert.match(source, /explicitDeviceSelected/)
  assert.match(source, /delete privateWindow\.__preparedSampleSttAudioInputDeviceId/)
  assert.match(source, /delete privateWindow\.__preparedSampleSttAudioOutputDeviceId/)
  assert.match(source, /context\.setSinkId\(outputDeviceId\)/)
  assert.match(source, /BROWSER_PLAYBACK_GAIN_DB = 12/)
  assert.match(source, /10 \*\* \(BROWSER_PLAYBACK_GAIN_DB \/ 20\)/)
  assert.match(source, /URL\.revokeObjectURL/)
  assert.match(source, /accepted_candidate_request_completed/)
  assert.match(source, /accepted_candidate_request_not_completed/)
  assert.match(source, /duplicate_final_or_playback_rejected/)
  assert.doesNotMatch(
    source.match(/const fixedOutput = [\s\S]*?\n\}\)/)?.[0] ?? '',
    /deviceId|device_label|device_id/
  )
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
    'SWORD_PREPARED_SAMPLE_ATTEMPT_COUNT',
    'SWORD_PREPARED_SAMPLE_AUDIO_ROUTE_CLASS',
  ]) {
    assert.match(privateEnvironmentBlock, new RegExp(key))
  }
  assert.match(source, /pipe:0/)
  assert.match(source, /'-af',\s*'volume=12dB'/)
  assert.doesNotMatch(
    source,
    /Set-AudioDevice|SetDefaultEndpoint|SoundVolumeView|global default/i
  )
  assert.doesNotMatch(source, /spawn\([\s\S]{0,300}audioPath/)
})

test('disables wide echo cancellation only for the fixed virtual-cable route', () => {
  assert.deepEqual(resolveBrowserLaunchArgs(AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT), [
    '--disable-popup-blocking',
  ])
  assert.deepEqual(
    resolveBrowserLaunchArgs(AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR),
    [
      '--disable-popup-blocking',
      '--disable-features=ChromeWideEchoCancellation',
    ]
  )
})
