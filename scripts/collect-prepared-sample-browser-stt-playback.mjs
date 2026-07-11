#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ATTEMPT_COUNT = 5
export const ATTEMPT_TIMEOUT_MS = 10_000
export const ROUTE_TIMEOUT_MS = 90_000
export const ROUTE_CANCEL_SETTLE_MS = 2_000
export const OPERATOR_PORT = 3000
const MAX_OPERATOR_RESPONSE_BYTES = 256 * 1024
const COMPLETE_CLEANUP_CLASS =
  'browser_closed_or_external_preserved_server_stopped_or_external_preserved_playback_processes_exited_temp_resources_deleted_volume_not_changed'
const PRIVATE_ENV_KEYS = [
  'SWORD_PREPARED_SAMPLE_OPERATOR_URL',
  'SWORD_PREPARED_SAMPLE_AUDIO_PATH',
  'SWORD_PREPARED_SAMPLE_EXPECTED_TEXT',
  'SWORD_PREPARED_SAMPLE_LOCALE',
  'SWORD_PREPARED_SAMPLE_FFPLAY_PATH',
  'SWORD_PREPARED_SAMPLE_LOCK_CLASS',
]

export class ControllerError extends Error {
  constructor(resultClass) {
    super(resultClass)
    this.name = 'ControllerError'
    this.resultClass = resultClass
  }
}

export const requireBrowserAudioAvailability = ({
  permissionAvailable,
  live,
  inputCount,
  outputCount,
}) => {
  if (!permissionAvailable || inputCount < 1) {
    throw new ControllerError(
      'browser_microphone_permission_or_device_unavailable'
    )
  }
  if (!live) {
    throw new ControllerError('browser_audio_input_track_not_live')
  }
  if (outputCount < 1) {
    throw new ControllerError('browser_audio_output_device_unavailable')
  }
}

const fixedOutput = (overrides = {}) => ({
  schema_version: 'prepared_sample_browser_stt_playback.v1',
  controller_status: 'completed',
  controller_stop_signal: 'completed_exactly_five_attempts',
  attempt_count: ATTEMPT_COUNT,
  playback_start_count: 0,
  playback_exit_zero_count: 0,
  result_event_count: 0,
  final_result_count: 0,
  content_match_stability_class: 'not_observed',
  blocker_class: null,
  cleanup_class: COMPLETE_CLEANUP_CLASS,
  system_volume_restore_class: 'not_changed',
  raw_audio_shared: false,
  raw_path_shared: false,
  raw_text_shared: false,
  private_environment_shared: false,
  user_heard_proven: false,
  turn_input_materialized: false,
  ...overrides,
})

const throwIfRouteAborted = (signal) => {
  if (!signal.aborted) return
  throw signal.reason instanceof ControllerError
    ? signal.reason
    : new ControllerError('whole_route_timeout')
}

const runRouteStep = async (signal, operation) => {
  throwIfRouteAborted(signal)
  const value = await operation()
  throwIfRouteAborted(signal)
  return value
}

const waitForRouteSettlement = async (operationOutcome, timeoutMs) => {
  let timer
  try {
    return await Promise.race([
      operationOutcome,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const withRouteTimeout = async (
  operation,
  timeoutMs = ROUTE_TIMEOUT_MS,
  cancelSettleMs = ROUTE_CANCEL_SETTLE_MS
) => {
  const controller = new AbortController()
  let timer
  try {
    const operationOutcome = operation(controller.signal).then(
      (value) => ({ class: 'operation_completed', value }),
      (error) => ({ class: 'operation_failed', error })
    )
    const outcome = await Promise.race([
      operationOutcome,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ class: 'route_timeout' }), timeoutMs)
      }),
    ])
    if (outcome.class === 'operation_completed') return outcome.value
    if (outcome.class === 'operation_failed') throw outcome.error

    const timeoutError = new ControllerError('whole_route_timeout')
    controller.abort(timeoutError)
    const settlement = await waitForRouteSettlement(
      operationOutcome,
      cancelSettleMs
    )
    if (!settlement) throw new ControllerError('cleanup_incomplete')
    throw timeoutError
  } finally {
    clearTimeout(timer)
  }
}

export const runPreparedSampleController = async ({
  adapter,
  expectedText,
  routeTimeoutMs = ROUTE_TIMEOUT_MS,
  routeCancelSettleMs = ROUTE_CANCEL_SETTLE_MS,
}) => {
  const activePlayers = new Set()
  const counts = {
    playbackStart: 0,
    playbackExitZero: 0,
    resultEvents: 0,
    finalResults: 0,
  }
  let cleanupError = null
  let result = null

  try {
    await adapter.acquireLock()
    result = await withRouteTimeout(async (signal) => {
      await runRouteStep(signal, () => adapter.startServer({ signal }))
      await runRouteStep(signal, () => adapter.launchBrowser({ signal }))
      await runRouteStep(signal, () => adapter.requireLiveAudioInput())

      for (let attempt = 0; attempt < ATTEMPT_COUNT; attempt += 1) {
        await runRouteStep(signal, () =>
          adapter.revalidateExternalServer()
        )
        await runRouteStep(signal, () => adapter.fillExpectedText(expectedText))
        await runRouteStep(signal, () => adapter.startAttempt())
        await runRouteStep(signal, () =>
          adapter.waitForStatus('attempt_listening', ATTEMPT_TIMEOUT_MS)
        )
        await runRouteStep(signal, () => adapter.requireRecognitionLocale())

        const before = await runRouteStep(signal, () =>
          adapter.readDiagnosticCounts()
        )
        const player = await runRouteStep(signal, async () => {
          const startedPlayer = await adapter.startPlayback({ signal })
          activePlayers.add(startedPlayer)
          counts.playbackStart += 1
          return startedPlayer
        })

        const outcome = await runRouteStep(signal, () =>
          adapter.waitForAttemptOutcome({
            beforeFinalCount: before.finalCount,
            timeoutMs: ATTEMPT_TIMEOUT_MS + 2_000,
          })
        )
        const playerResult = await runRouteStep(signal, () =>
          adapter.stopPlayback(player)
        )
        activePlayers.delete(player)
        if (playerResult.exitClass === 'exit_zero') {
          counts.playbackExitZero += 1
        } else if (playerResult.exitClass !== 'controlled_stop_after_result') {
          throw new ControllerError('playback_exit_nonzero')
        }

        if (outcome.class !== 'final_result') {
          throw new ControllerError('browser_stt_no_final_result_before_timeout')
        }
        await runRouteStep(signal, () => adapter.recordFinalResult())
        await runRouteStep(signal, () =>
          adapter.waitForStatus('attempt_recorded', ATTEMPT_TIMEOUT_MS)
        )

        const after = await runRouteStep(signal, () =>
          adapter.readDiagnosticCounts()
        )
        counts.resultEvents += Math.max(0, after.resultCount - before.resultCount)
        counts.finalResults += Math.max(0, after.finalCount - before.finalCount)
      }

      const summary = await runRouteStep(signal, () => adapter.readRunSummary())
      if (summary.attemptCount !== ATTEMPT_COUNT) {
        throw new ControllerError('bounded_attempt_count_not_met')
      }
      if (summary.stabilityClass !== 'stable_positive') {
        throw new ControllerError('repeat_content_match_not_stable')
      }

      return fixedOutput({
        playback_start_count: counts.playbackStart,
        playback_exit_zero_count: counts.playbackExitZero,
        result_event_count: counts.resultEvents,
        final_result_count: counts.finalResults,
        content_match_stability_class: summary.stabilityClass,
      })
    }, routeTimeoutMs, routeCancelSettleMs)
  } catch (error) {
    const resultClass =
      error instanceof ControllerError
        ? error.resultClass
        : 'prepared_sample_playback_controller_failed'
    const cleanupIncomplete = resultClass === 'cleanup_incomplete'
    result = fixedOutput({
      controller_status: 'error',
      controller_stop_signal: cleanupIncomplete
        ? 'stopped_on_cleanup_incomplete'
        : 'stopped_on_first_fail_closed_blocker',
      attempt_count: 0,
      playback_start_count: counts.playbackStart,
      playback_exit_zero_count: counts.playbackExitZero,
      result_event_count: counts.resultEvents,
      final_result_count: counts.finalResults,
      blocker_class: resultClass,
      cleanup_class: cleanupIncomplete
        ? 'cleanup_incomplete'
        : COMPLETE_CLEANUP_CLASS,
    })
  } finally {
    for (const player of [...activePlayers]) {
      try {
        await adapter.stopPlayback(player)
        activePlayers.delete(player)
      } catch {
        cleanupError = 'cleanup_incomplete'
      }
    }
    for (const cleanup of [
      'stopRecognition',
      'closeBrowser',
      'stopServer',
      'deleteTempResources',
      'releaseLock',
    ]) {
      try {
        await adapter[cleanup]?.()
      } catch {
        cleanupError = 'cleanup_incomplete'
      }
    }
    if (cleanupError) {
      result = fixedOutput({
        controller_status: 'error',
        controller_stop_signal: 'stopped_on_cleanup_incomplete',
        attempt_count: 0,
        playback_start_count: counts.playbackStart,
        playback_exit_zero_count: counts.playbackExitZero,
        result_event_count: counts.resultEvents,
        final_result_count: counts.finalResults,
        blocker_class: 'cleanup_incomplete',
        cleanup_class: 'cleanup_incomplete',
      })
    }
  }
  return result
}

const requestOperatorSurface = (url) =>
  new Promise((resolve) => {
    const request = http.get(url, (response) => {
      const chunks = []
      let size = 0
      const contentType = String(response.headers['content-type'] || '')
      const poweredBy = String(response.headers['x-powered-by'] || '')
      response.on('data', (chunk) => {
        size += chunk.length
        if (size > MAX_OPERATOR_RESPONSE_BYTES) {
          request.destroy()
          resolve(false)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve(
          response.statusCode === 200 &&
            contentType.includes('text/html') &&
            poweredBy.toLowerCase().includes('next.js') &&
            body.includes('Prepared Sample Browser STT') &&
            body.includes('prepared-sample-stt-status') &&
            body.includes('parent_preflight_mount_pending')
        )
      })
    })
    request.on('error', () => resolve(false))
    request.setTimeout(1_000, () => {
      request.destroy()
      resolve(false)
    })
  })

export const resolveOperatorServerMode = async ({
  canBind = canBindOperatorPort,
  inspectOwner = inspectOperatorServerOwner,
  probe = requestOperatorSurface,
  operatorUrl,
}) => {
  if (await canBind()) {
    return { serverMode: 'start_owned', externalServerIdentity: null }
  }
  const initialIdentity = await inspectOwner()
  if (!initialIdentity) {
    throw new ControllerError('operator_server_collision')
  }
  if (!(await probe(operatorUrl))) {
    throw new ControllerError('operator_server_collision')
  }
  const confirmedIdentity = await inspectOwner()
  if (!sameOperatorServerIdentity(initialIdentity, confirmedIdentity)) {
    throw new ControllerError('operator_server_collision')
  }
  return {
    serverMode: 'attach_external',
    externalServerIdentity: initialIdentity,
  }
}

const canBindOperatorPort = () =>
  new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(OPERATOR_PORT, '127.0.0.1', () => {
      server.close(() => resolve(true))
    })
  })

export const createPublicChildEnvironment = (source = process.env) => {
  const childEnvironment = { ...source }
  for (const key of PRIVATE_ENV_KEYS) {
    delete childEnvironment[key]
  }
  return childEnvironment
}

const sameOperatorServerIdentity = (expected, actual) =>
  Boolean(
    expected &&
      actual &&
      Number.isSafeInteger(expected.pid) &&
      expected.pid > 0 &&
      typeof expected.startTicks === 'string' &&
      /^\d{1,19}$/.test(expected.startTicks) &&
      expected.pid === actual.pid &&
      expected.startTicks === actual.startTicks
  )

const parseOperatorServerIdentity = (output) => {
  const match = /^owned:(\d{1,10}):(\d{1,19})$/.exec(output.trim())
  if (!match) return null
  const pid = Number(match[1])
  const startTicks = match[2]
  if (!Number.isSafeInteger(pid) || pid < 1) return null
  return Object.freeze({ pid, startTicks })
}

export const buildOperatorServerOwnerInspectionScript = (
  port = OPERATOR_PORT
) =>
  [
      "$ErrorActionPreference='Stop'",
      'try {',
      "  $root=[IO.Path]::GetFullPath($env:SWORD_EXPECTED_AIT_ROOT).TrimEnd('\\')",
      `  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Where-Object { $_.LocalAddress -in @('127.0.0.1','::1') })`,
      '  $owners=@($listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)',
      "  if($owners.Count -ne 1){'unowned';exit 0}",
      "  $process=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $owners[0]) -ErrorAction Stop",
      '  $name=[string]$process.Name',
      '  $ticks=[Int64]$process.CreationDate.ToUniversalTime().Ticks',
      "  $command=([string]$process.CommandLine).Replace('/','\\')",
      "  $parent=if([int]$process.ParentProcessId -gt 0){Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$process.ParentProcessId) -ErrorAction SilentlyContinue}else{$null}",
      "  $parentName=if($null -ne $parent){[string]$parent.Name}else{''}",
      "  $parentCommand=if($null -ne $parent){([string]$parent.CommandLine).Replace('/','\\')}else{''}",
      `  $directOwned=($name -in @('node','node.exe')) -and $command.Contains($root + '\\') -and $command.Contains('node_modules\\next\\dist\\bin\\next') -and ($command -match '(?i)(^|\\s)dev(\\s|$)') -and $command.Contains('-H 127.0.0.1') -and $command.Contains('-p ${port}')`,
      `  $parentOwned=($parentName -in @('node','node.exe')) -and $parentCommand.Contains($root + '\\') -and $parentCommand.Contains('node_modules\\next\\dist\\bin\\next') -and ($parentCommand -match '(?i)(^|\\s)dev(\\s|$)') -and $parentCommand.Contains('-H 127.0.0.1') -and $parentCommand.Contains('-p ${port}')`,
      "  $sealedChild=($name -in @('node','node.exe')) -and $command.Contains($root + '\\node_modules\\next\\dist\\server\\lib\\start-server') -and ($null -ne $parent) -and ([int]$process.ParentProcessId -eq [int]$parent.ProcessId) -and $parentOwned",
      '  $owned=$directOwned -or $sealedChild',
      "  if($owned){'owned:{0}:{1}' -f $owners[0],$ticks}else{'unowned'}",
      "} catch {'unowned'}",
    ].join(';')

const inspectOperatorServerOwner = () =>
  new Promise((resolve) => {
    const windowsPowerShell = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    )
    const script = buildOperatorServerOwnerInspectionScript()
    const environment = createPublicChildEnvironment()
    environment.SWORD_EXPECTED_AIT_ROOT = process.cwd()
    let timer = null
    const child = spawn(
      windowsPowerShell,
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: environment, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    let output = ''
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      delete environment.SWORD_EXPECTED_AIT_ROOT
      resolve(value)
    }
    child.stdout.on('data', (chunk) => {
      if (output.length < 32) output += chunk.toString('utf8')
    })
    child.once('error', () => finish(false))
    child.once('close', (code) =>
      finish(code === 0 ? parseOperatorServerIdentity(output) : null)
    )
    timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, 3_000)
  })

const waitForServer = async (
  url,
  child,
  timeoutMs = 30_000,
  signal = null
) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal) throwIfRouteAborted(signal)
    if (child.exitCode !== null) {
      throw new ControllerError('operator_server_start_failed')
    }
    if (await requestOperatorSurface(url)) return
    await sleep(300)
  }
  throw new ControllerError('operator_server_start_failed')
}

const waitForChildExit = (child, timeoutMs = 5_000) =>
  Promise.race([
    new Promise((resolve) => child.once('close', (code) => resolve(code))),
    sleep(timeoutMs).then(() => null),
  ])

export const stopOwnedProcess = async ({
  hasExited,
  terminate,
  forceTerminate,
  waitForExit,
  gracefulTimeoutMs = 3_000,
  forceTimeoutMs = 1_000,
}) => {
  let controlled = false
  if (!hasExited()) {
    controlled = true
    terminate()
    await waitForExit(gracefulTimeoutMs)
  }
  if (!hasExited()) {
    forceTerminate()
    await waitForExit(forceTimeoutMs)
  }
  if (!hasExited()) {
    throw new ControllerError('cleanup_incomplete')
  }
  return { controlled }
}

export const stopTrackedServer = async ({
  serverMode,
  serverChild,
  waitForExit = waitForChildExit,
}) => {
  if (serverMode === 'none') return { serverMode, serverChild }
  if (serverMode === 'attach_external') {
    return { serverMode: 'none', serverChild: null }
  }
  if (serverMode !== 'start_owned' || !serverChild) {
    throw new ControllerError('cleanup_incomplete')
  }
  await stopOwnedProcess({
    hasExited: () => serverChild.exitCode !== null,
    terminate: () => serverChild.kill(),
    forceTerminate: () => serverChild.kill('SIGKILL'),
    waitForExit: (timeoutMs) => waitForExit(serverChild, timeoutMs),
  })
  return { serverMode: 'none', serverChild: null }
}

export const createRuntimeAdapter = ({
  operatorUrl,
  audioPath,
  locale,
  ffplayPath,
  lockClass,
  inspectOwner = inspectOperatorServerOwner,
}) => {
  let serverChild = null
  let context = null
  let page = null
  let profileDirectory = null
  let serverMode = 'none'
  let externalServerIdentity = null

  return {
    async acquireLock() {
      if (lockClass !== 'held_by_parent') {
        throw new ControllerError('controller_lock_held')
      }
    },
    async releaseLock() {},
    async startServer({ signal } = {}) {
      if (signal) throwIfRouteAborted(signal)
      const resolution = await resolveOperatorServerMode({
        operatorUrl,
        inspectOwner,
      })
      serverMode = resolution.serverMode
      externalServerIdentity = resolution.externalServerIdentity
      if (signal) throwIfRouteAborted(signal)
      if (serverMode === 'attach_external') return
      const nextBin = path.join(
        process.cwd(),
        'node_modules',
        'next',
        'dist',
        'bin',
        'next'
      )
      serverChild = spawn(
        process.execPath,
        [nextBin, 'dev', '-H', '127.0.0.1', '-p', String(OPERATOR_PORT)],
        {
          cwd: process.cwd(),
          env: createPublicChildEnvironment(),
          stdio: ['ignore', 'ignore', 'ignore'],
        }
      )
      await waitForServer(operatorUrl, serverChild, 30_000, signal)
    },
    async stopServer() {
      const stopped = await stopTrackedServer({ serverMode, serverChild })
      serverMode = stopped.serverMode
      serverChild = stopped.serverChild
      externalServerIdentity = null
    },
    async revalidateExternalServer() {
      if (serverMode !== 'attach_external') return
      const currentIdentity = await inspectOwner()
      if (!sameOperatorServerIdentity(externalServerIdentity, currentIdentity)) {
        throw new ControllerError('operator_server_collision')
      }
    },
    async launchBrowser({ signal } = {}) {
      if (signal) throwIfRouteAborted(signal)
      profileDirectory = await mkdtemp(
        path.join(os.tmpdir(), 'prepared-sample-browser-stt-')
      )
      try {
        context = await chromium.launchPersistentContext(profileDirectory, {
          channel: 'chrome',
          headless: false,
          timeout: 30_000,
          args: ['--use-fake-ui-for-media-stream'],
          env: createPublicChildEnvironment(),
        })
        if (signal) throwIfRouteAborted(signal)
        await context.grantPermissions(['microphone'], {
          origin: 'http://127.0.0.1:3000',
        })
        if (signal) throwIfRouteAborted(signal)
        page = context.pages()[0] ?? (await context.newPage())
        await page.addInitScript((expectedLocale) => {
          window.__preparedSampleSttCounts = {
            resultCount: 0,
            finalCount: 0,
            localeClass: 'unobserved',
          }
          window.addEventListener('projection-visual-stt-diagnostic', (event) => {
            const detail = event.detail
            if (detail?.controller !== 'browser_stt') {
              return
            }
            if (detail.event === 'onstart') {
              window.__preparedSampleSttCounts.localeClass =
                detail.detail === `lang=${expectedLocale}`
                  ? 'expected_locale'
                  : 'locale_mismatch'
              return
            }
            if (!String(detail.event || '').startsWith('onresult')) return
            window.__preparedSampleSttCounts.resultCount += 1
            if (detail.event === 'onresult_final') {
              window.__preparedSampleSttCounts.finalCount += 1
            }
          })
        }, locale)
        if (signal) throwIfRouteAborted(signal)
        await page.goto(operatorUrl, { waitUntil: 'domcontentloaded' })
        if (signal) throwIfRouteAborted(signal)
        await page.getByTestId('prepared-sample-stt-status').waitFor({
          state: 'visible',
          timeout: 30_000,
        })
      } catch (error) {
        if (signal?.aborted) throwIfRouteAborted(signal)
        throw new ControllerError('browser_launch_failed')
      }
    },
    async requireLiveAudioInput() {
      const result = await page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          })
          const tracks = stream.getAudioTracks()
          const live =
            tracks.length > 0 &&
            tracks.every((track) => track.readyState === 'live')
          const devices = await navigator.mediaDevices.enumerateDevices()
          tracks.forEach((track) => track.stop())
          return {
            permissionAvailable: true,
            live,
            inputCount: devices.filter((device) => device.kind === 'audioinput')
              .length,
            outputCount: devices.filter(
              (device) => device.kind === 'audiooutput'
            ).length,
          }
        } catch {
          return {
            permissionAvailable: false,
            live: false,
            inputCount: 0,
            outputCount: 0,
          }
        }
      })
      requireBrowserAudioAvailability(result)
    },
    async fillExpectedText(expectedText) {
      await page.getByLabel('Expected prepared-sample text').fill(expectedText)
    },
    async requireRecognitionLocale() {
      try {
        await page.waitForFunction(
          () =>
            window.__preparedSampleSttCounts.localeClass !== 'unobserved',
          undefined,
          { timeout: 2_000 }
        )
      } catch {
        throw new ControllerError('browser_stt_locale_mismatch')
      }
      const localeClass = await page.evaluate(
        () => window.__preparedSampleSttCounts.localeClass
      )
      if (localeClass !== 'expected_locale') {
        throw new ControllerError('browser_stt_locale_mismatch')
      }
    },
    async startAttempt() {
      await page.getByRole('button', { name: 'Start bounded attempt' }).click()
    },
    async waitForStatus(status, timeoutMs) {
      try {
        await page.getByTestId('prepared-sample-stt-status').filter({
          hasText: status,
        }).waitFor({ timeout: timeoutMs })
      } catch {
        throw new ControllerError(
          status === 'attempt_listening'
            ? 'attempt_listening_not_reached'
            : 'prepared_sample_page_state_invalid'
        )
      }
    },
    async readDiagnosticCounts() {
      return page.evaluate(() => ({ ...window.__preparedSampleSttCounts }))
    },
    async startPlayback({ signal } = {}) {
      if (signal) throwIfRouteAborted(signal)
      if (!existsSync(ffplayPath) || !existsSync(audioPath)) {
        throw new ControllerError('playback_process_start_failed')
      }
      const child = spawn(
        ffplayPath,
        [
          '-nodisp',
          '-autoexit',
          '-loglevel',
          'quiet',
          '-nostats',
          '-volume',
          '100',
          '-i',
          'pipe:0',
        ],
        {
          env: createPublicChildEnvironment(),
          stdio: ['pipe', 'ignore', 'ignore'],
        }
      )
      child.exitClass = null
      child.exitPromise = new Promise((resolve) => {
        child.once('error', () => {
          child.exitClass = 'spawn_failed'
          resolve()
        })
        child.once('close', (code) => {
          child.exitClass = code === 0 ? 'exit_zero' : 'exit_nonzero'
          resolve()
        })
      })
      const input = createReadStream(audioPath)
      child.inputStream = input
      input.once('error', () => child.kill())
      input.pipe(child.stdin)
      return child
    },
    async stopPlayback(player) {
      player.inputStream?.destroy()
      const { controlled } = await stopOwnedProcess({
        hasExited: () => player.exitClass !== null,
        terminate: () => player.kill(),
        forceTerminate: () => player.kill('SIGKILL'),
        waitForExit: (timeoutMs) =>
          Promise.race([player.exitPromise, sleep(timeoutMs)]),
      })
      return {
        exitClass: controlled
          ? 'controlled_stop_after_result'
          : player.exitClass,
      }
    },
    async waitForAttemptOutcome({ beforeFinalCount, timeoutMs }) {
      try {
        await page.waitForFunction(
          (before) =>
            window.__preparedSampleSttCounts.finalCount > before ||
            document.querySelector('[data-testid="prepared-sample-stt-status"]')
              ?.textContent === 'attempt_timeout',
          beforeFinalCount,
          { timeout: timeoutMs }
        )
      } catch {
        throw new ControllerError('browser_stt_no_final_result_before_timeout')
      }
      const state = await page.evaluate((before) => ({
        finalObserved: window.__preparedSampleSttCounts.finalCount > before,
        status: document.querySelector(
          '[data-testid="prepared-sample-stt-status"]'
        )?.textContent,
      }), beforeFinalCount)
      return {
        class: state.finalObserved ? 'final_result' : state.status,
      }
    },
    async recordFinalResult() {
      await page.getByRole('button', { name: 'Record final result' }).click()
    },
    async readRunSummary() {
      const attemptText = await page.getByText(/^Attempts:/).textContent()
      const stability = await page
        .getByText('Stability')
        .locator('xpath=following-sibling::*[1]')
        .textContent()
      return {
        attemptCount: Number(attemptText?.match(/(\d+)\/5/)?.[1] ?? 0),
        stabilityClass: String(stability || '').trim(),
      }
    },
    async stopRecognition() {
      if (!page) return
      const record = page.getByRole('button', { name: 'Record final result' })
      if (await record.isEnabled().catch(() => false)) {
        await record.click().catch(() => undefined)
      }
    },
    async closeBrowser() {
      await context?.close()
      context = null
      page = null
    },
    async deleteTempResources() {
      if (profileDirectory) {
        await rm(profileDirectory, { recursive: true, force: true })
        profileDirectory = null
      }
    },
  }
}

const requirePrivateEnvironment = () => {
  const values = {
    operatorUrl: process.env.SWORD_PREPARED_SAMPLE_OPERATOR_URL || '',
    audioPath: process.env.SWORD_PREPARED_SAMPLE_AUDIO_PATH || '',
    expectedText: process.env.SWORD_PREPARED_SAMPLE_EXPECTED_TEXT || '',
    locale: process.env.SWORD_PREPARED_SAMPLE_LOCALE || '',
    ffplayPath: process.env.SWORD_PREPARED_SAMPLE_FFPLAY_PATH || '',
    lockClass: process.env.SWORD_PREPARED_SAMPLE_LOCK_CLASS || '',
  }
  if (!values.operatorUrl || !values.audioPath || !values.expectedText) {
    throw new ControllerError(
      'prepared_sample_expected_text_authority_missing_or_invalid'
    )
  }
  if (!values.locale || !values.ffplayPath || !values.lockClass) {
    throw new ControllerError('prepared_sample_playback_dependency_unavailable')
  }
  return values
}

const clearPrivateProcessEnvironment = () => {
  for (const key of PRIVATE_ENV_KEYS) delete process.env[key]
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isMain) {
  let result
  let privateValues = null
  try {
    privateValues = requirePrivateEnvironment()
    clearPrivateProcessEnvironment()
    result = await runPreparedSampleController({
      adapter: createRuntimeAdapter(privateValues),
      expectedText: privateValues.expectedText,
    })
  } catch (error) {
    result = fixedOutput({
      controller_status: 'error',
      controller_stop_signal: 'stopped_before_runtime',
      attempt_count: 0,
      blocker_class:
        error instanceof ControllerError
          ? error.resultClass
          : 'prepared_sample_playback_controller_failed',
    })
  } finally {
    clearPrivateProcessEnvironment()
    if (privateValues) {
      for (const key of Object.keys(privateValues)) privateValues[key] = ''
    }
  }
  console.log(JSON.stringify(result))
  if (result.controller_status !== 'completed') process.exitCode = 1
}
