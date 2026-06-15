#!/usr/bin/env node
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

const TOPIC = '/vision/sword_sign/state'
const DEFAULT_TIMEOUT_MS = 90000
const SCHEMA_VERSION = 'rr003.projection_gesture_voice_events.v1'

const CASES = [
  {
    case_id: 'sword-positive',
    asset_id: 'gesture.sword.20260603',
    proof_scope: 'projection_bridge_contract',
    proof_case_type: 'synthetic_positive_signal',
    input_mode: 'synthetic_redacted_gesture_state',
    expected_gate: 'open',
    fixture_expected_gate: 'open',
    active: true,
    primary: 'sword_sign',
    confidence: 0.98,
  },
  {
    case_id: 'victory-upstream-false-positive-propagation',
    asset_id: 'gesture.victory.20260603',
    proof_scope: 'upstream_false_positive_propagation',
    proof_case_type: 'upstream_false_positive_propagation_test',
    input_mode: 'synthetic_redacted_gesture_state',
    expected_gate: 'open',
    fixture_expected_gate: 'closed',
    active: true,
    primary: 'sword_sign',
    confidence: 0.96,
  },
  {
    case_id: 'open-hand-negative',
    asset_id: 'gesture.open_hand.20260603',
    proof_scope: 'projection_bridge_contract',
    proof_case_type: 'synthetic_negative_signal',
    input_mode: 'synthetic_redacted_gesture_state',
    expected_gate: 'closed',
    fixture_expected_gate: 'closed',
    active: false,
    primary: null,
    confidence: 0,
  },
]

class CollectorError extends Error {
  constructor(stage, publicMessage, details = {}) {
    super(publicMessage)
    this.name = 'CollectorError'
    this.stage = stage
    this.publicMessage = publicMessage
    this.details = details
  }
}

const safetyFlags = () => ({
  raw_media_saved_or_shared: false,
  raw_audio_saved_or_shared: false,
  raw_video_saved_or_shared: false,
  raw_frame_saved_or_shared: false,
  raw_transcript_saved_or_shared: false,
  screenshot_saved_or_shared: false,
  secret_or_token_shared: false,
})

const normalizeCollectorError = (error) => {
  if (error instanceof CollectorError) {
    return error
  }
  return new CollectorError('unknown', 'collector failed before proof summary completed')
}

const parseArgs = () => {
  const args = process.argv.slice(2)
  const options = {
    headed: false,
    keepServer: false,
    failOnRobustGateFail: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    port: 0,
    executablePath: process.env.PLAYWRIGHT_CHROME_EXECUTABLE || '',
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--headed') {
      options.headed = true
    } else if (arg === '--keep-server') {
      options.keepServer = true
    } else if (arg === '--fail-on-robust-gate-fail') {
      options.failOnRobustGateFail = true
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(args[++index])
    } else if (arg === '--port') {
      options.port = Number(args[++index])
    } else if (arg === '--executable-path') {
      options.executablePath = String(args[++index] || '')
    } else {
      throw new Error(`unsupported argument: ${arg}`)
    }
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number')
  }
  if (!Number.isInteger(options.port) || options.port < 0) {
    throw new Error('--port must be a non-negative integer')
  }

  return options
}

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })

const requestOk = (url) =>
  new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })
    request.on('error', () => resolve(false))
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })
  })

const waitForHttp = async (url, timeoutMs, childState) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (childState.spawnError) {
      throw new CollectorError('app-start', 'next dev process failed to start')
    }
    if (childState.exited) {
      throw new CollectorError('app-start', 'next dev process exited before route was ready', {
        exit_code: childState.exitCode,
        signal: childState.signal,
      })
    }
    if (await requestOk(url)) {
      return
    }
    await sleep(500)
  }
  throw new CollectorError('route-not-ready', 'projection visual route was not ready before timeout')
}

const startNextDev = async ({ port, timeoutMs }) => {
  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
  const childState = {
    exited: false,
    exitCode: null,
    signal: null,
    spawnError: false,
  }
  const child = spawn(process.execPath, [nextBin, 'dev', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_GESTURE_VOICE_BRIDGE_ENABLED: 'true',
      NEXT_PUBLIC_GESTURE_VOICE_WS_URL: 'ws://127.0.0.1:9/rr003-redacted-collector',
      NEXT_PUBLIC_GESTURE_VOICE_USE_STABLE: 'true',
      NEXT_PUBLIC_BROWSER_STT_PERMISSION_PREFLIGHT: 'false',
      NEXT_PUBLIC_BROWSER_STT_START_BUFFER_MS: '0',
      NEXT_PUBLIC_BROWSER_STT_SOUND_WATCHDOG_MS: '5000',
      NEXT_PUBLIC_BROWSER_STT_AUDIO_RETRY_LIMIT: '0',
      NEXT_PUBLIC_SPEECH_RECOGNITION_MODE: 'browser',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', () => undefined)
  child.stderr.on('data', () => undefined)

  child.on('error', () => {
    childState.spawnError = true
  })

  child.on('exit', (code) => {
    childState.exited = true
    childState.exitCode = code
    if (code !== null && code !== 0) {
      // Keep stdout/stderr private; the final result reports only sanitized status.
    }
  })

  child.on('close', (code, signal) => {
    childState.exited = true
    childState.exitCode = code
    childState.signal = signal
  })

  const url = `http://127.0.0.1:${port}/projection-visual/?hud=1`
  try {
    await waitForHttp(url, timeoutMs, childState)
  } catch (error) {
    child.kill()
    throw error
  }
  return { child, url }
}

const installBrowserStubs = async (page) => {
  await page.addInitScript(() => {
    window.__rr003GestureBridgeEvents = []
    window.__rr003FakeWebSockets = []

    const pushBridgeEvent = (detail) => {
      if (!detail || detail.controller !== 'gesture_bridge') {
        return
      }
      window.__rr003GestureBridgeEvents.push(String(detail.event || 'unknown'))
    }

    window.addEventListener('projection-visual-stt-diagnostic', (event) => {
      pushBridgeEvent(event.detail)
    })

    class FakeWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      constructor(url) {
        this.url = url
        this.readyState = FakeWebSocket.CONNECTING
        window.__rr003FakeWebSockets.push(this)
        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN
          this.onopen?.({ type: 'open' })
        }, 0)
      }

      send() {}

      close() {
        this.readyState = FakeWebSocket.CLOSED
        this.onclose?.({ type: 'close' })
      }

      __emit(message) {
        this.onmessage?.({ data: JSON.stringify(message) })
      }
    }

    class FakeSpeechRecognition {
      constructor() {
        this.lang = 'ja-JP'
        this.continuous = true
        this.interimResults = true
        this._active = false
      }

      start() {
        this._active = true
        setTimeout(() => this.onstart?.({ type: 'start' }), 0)
      }

      stop() {
        this._active = false
        setTimeout(() => this.onend?.({ type: 'end' }), 0)
      }

      abort() {
        this._active = false
        setTimeout(() => this.onend?.({ type: 'end' }), 0)
      }
    }

    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    })
    Object.defineProperty(window, 'SpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    })
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: FakeSpeechRecognition,
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{ stop: () => undefined }],
        }),
      },
    })

    window.__rr003EmitGestureMessage = (message) => {
      const socket =
        window.__rr003FakeWebSockets[window.__rr003FakeWebSockets.length - 1]
      if (!socket) {
        throw new Error('redacted collector websocket is not ready')
      }
      socket.__emit(message)
    }
  })
}

const buildGestureMessage = (testCase, sequence) => ({
  topic: TOPIC,
  header: { seq: sequence },
  payload: {
    type: 'gesture_state',
    sequence,
    source: 'rr003_redacted_projection_collector',
    hand_detected: testCase.active,
    primary: testCase.primary,
    primary_gesture: testCase.primary,
    gestures: {
      sword_sign: {
        active: testCase.active,
        confidence: testCase.confidence,
      },
      victory: {
        active: false,
        confidence: 0,
      },
    },
    stable: {
      target: 'sword_sign',
      gestures: {
        sword_sign: {
          active: testCase.active,
          activated: testCase.active,
          released: !testCase.active,
        },
      },
    },
  },
})

const evaluateCase = (testCase, observedEventNames) => {
  const uniqueObservedEventNames = [...new Set(observedEventNames)]
  const gestureStartRequestObserved = observedEventNames.includes(
    'gesture_start_request'
  )
  const gestureStartResultObserved = observedEventNames.includes(
    'gesture_start_result'
  )
  const opened = gestureStartRequestObserved && gestureStartResultObserved
  const pass =
    testCase.expected_gate === 'open' ? opened : !opened
  const fixturePass =
    testCase.fixture_expected_gate === 'open' ? opened : !opened

  return {
    case_id: testCase.case_id,
    asset_id: testCase.asset_id,
    proof_scope: testCase.proof_scope,
    proof_case_type: testCase.proof_case_type,
    input_mode: testCase.input_mode,
    expected_gate: testCase.expected_gate,
    fixture_expected_gate: testCase.fixture_expected_gate,
    observed_event_names: uniqueObservedEventNames,
    gesture_start_request_observed: gestureStartRequestObserved,
    gesture_start_result_observed: gestureStartResultObserved,
    result: pass ? 'pass' : 'fail',
    fixture_result: fixturePass ? 'pass' : 'fail',
    raw_media_saved_or_shared: false,
  }
}

const runCase = async ({ browser, url, testCase }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await installBrowserStubs(page)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(
    () => window.__rr003GestureBridgeEvents?.includes('gesture_ws_open'),
    null,
    { timeout: 30000 }
  )
  await page.evaluate((message) => {
    window.__rr003EmitGestureMessage(message)
  }, buildGestureMessage(testCase, 1))
  await page.waitForTimeout(1200)
  const observedEventNames = await page.evaluate(
    () => window.__rr003GestureBridgeEvents ?? []
  )
  await context.close()
  return evaluateCase(testCase, observedEventNames)
}

const main = async () => {
  const options = parseArgs()
  const port = options.port || (await getFreePort())
  const server = await startNextDev({ port, timeoutMs: options.timeoutMs })
  const launchOptions = {
    headless: !options.headed,
    ...(options.executablePath
      ? { executablePath: options.executablePath }
      : { channel: 'chrome' }),
  }
  let browser
  try {
    try {
      browser = await chromium.launch(launchOptions)
    } catch {
      throw new CollectorError('browser-launch', 'browser launch failed')
    }
    const cases = []
    for (const testCase of CASES) {
      try {
        cases.push(await runCase({ browser, url: server.url, testCase }))
      } catch {
        throw new CollectorError('browser-runtime', 'browser runtime case collection failed')
      }
    }
    const positive = cases.find((item) => item.case_id === 'sword-positive')
    const victoryPropagation = cases.find(
      (item) =>
        item.case_id === 'victory-upstream-false-positive-propagation'
    )
    const openHand = cases.find((item) => item.case_id === 'open-hand-negative')
    const robustGreen =
      positive?.result === 'pass' &&
      victoryPropagation?.fixture_result === 'pass' &&
      openHand?.result === 'pass'
    const upstreamFalsePositivePropagates =
      victoryPropagation?.result === 'pass' &&
      victoryPropagation?.fixture_result === 'fail'

    const output = {
      schema_version: SCHEMA_VERSION,
      collector_status: 'completed',
      command_mode: options.failOnRobustGateFail
        ? 'release-gate'
        : 'collect-only',
      exit_policy: options.failOnRobustGateFail
        ? 'nonzero-on-robust-gate-fail'
        : 'zero-if-collector-completes',
      proof_layer: 'browser-runtime-redacted',
      collector: 'scripts/collect-projection-gesture-voice-events.mjs',
      cases,
      summary: {
        robust_gesture_gate_green: robustGreen,
        positive_transition_pass: positive?.result === 'pass',
        actual_victory_replay_or_camera_hub_summary_proven: false,
        victory_negative_fixture_proven_closed:
          victoryPropagation?.fixture_result === 'pass',
        upstream_false_positive_propagates_to_bridge:
          upstreamFalsePositivePropagates,
        open_hand_false_open_remaining: openHand?.result === 'fail',
      },
      safety: {
        ...safetyFlags(),
      },
    }

    console.log(JSON.stringify(output, null, 2))
    if (options.failOnRobustGateFail && !robustGreen) {
      process.exitCode = 2
    }
  } finally {
    if (browser) {
      await browser.close()
    }
    if (!options.keepServer) {
      server.child.kill()
    }
  }
}

main().catch((error) => {
  const collectorError = normalizeCollectorError(error)
  console.error(
    JSON.stringify({
      schema_version: SCHEMA_VERSION,
      collector_status: 'error',
      result: 'error',
      failure_stage: collectorError.stage,
      error: collectorError.publicMessage,
      details: collectorError.details,
      safety: {
        ...safetyFlags(),
      },
    })
  )
  process.exitCode = 1
})
