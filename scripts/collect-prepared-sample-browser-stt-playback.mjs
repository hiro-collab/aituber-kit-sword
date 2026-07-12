#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createReadStream, existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

export const ATTEMPT_COUNT = 5
export const INTEGRATED_ATTEMPT_COUNT = 1
export const ATTEMPT_TIMEOUT_MS = 10_000
export const ROUTE_TIMEOUT_MS = 90_000
export const ROUTE_CANCEL_SETTLE_MS = 2_000
export const OPERATOR_PORT = 3000
export const AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT = 'system_default'
export const AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR =
  'installed_virtual_cable_pair_v1'
export const BROWSER_PLAYBACK_GAIN_DB = 12
export const BROWSER_PLAYBACK_GAIN_LINEAR = 10 ** (BROWSER_PLAYBACK_GAIN_DB / 20)
export const MAX_PREPARED_SAMPLE_AUDIO_BYTES = 32 * 1024 * 1024
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
  'SWORD_PREPARED_SAMPLE_ATTEMPT_COUNT',
  'SWORD_PREPARED_SAMPLE_AUDIO_ROUTE_CLASS',
  'SWORD_PREPARED_SAMPLE_INTEGRATED_PRESENTATION',
]
export const SAFE_PUBLIC_CHILD_ENV_KEYS = Object.freeze([
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'TEMP',
  'TMP',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'NUMBER_OF_PROCESSORS',
  'OS',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'HOMEDRIVE',
  'HOMEPATH',
  'PSModulePath',
])
const FIXED_VIRTUAL_AUDIO_ENDPOINTS = Object.freeze({
  captureLabel: 'CABLE Output (VB-Audio Virtual Cable)',
  renderLabel: 'CABLE Input (VB-Audio Virtual Cable)',
})
const BROWSER_AUDIO_URL =
  'http://127.0.0.1:3000/__prepared_sample_audio_route__/canonical'

export class ControllerError extends Error {
  constructor(resultClass) {
    super(resultClass)
    this.name = 'ControllerError'
    this.resultClass = resultClass
  }
}

const isBoundedDeviceField = (value, maximum) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maximum &&
  !/[\u0000-\u001f\u007f]/.test(value)

const resolveFixedAudioEndpoints = (devices, audioRouteClass) => {
  if (audioRouteClass !== AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR) {
    return { captureMatches: [], renderMatches: [] }
  }
  return {
    captureMatches: devices.filter(
      (device) =>
        device.kind === 'audioinput' &&
        device.label === FIXED_VIRTUAL_AUDIO_ENDPOINTS.captureLabel &&
        isBoundedDeviceField(device.deviceId, 512)
    ),
    renderMatches: devices.filter(
      (device) =>
        device.kind === 'audiooutput' &&
        device.label === FIXED_VIRTUAL_AUDIO_ENDPOINTS.renderLabel &&
        isBoundedDeviceField(device.deviceId, 512)
    ),
  }
}

export const classifyFixedAudioEndpointSelection = (
  devices,
  audioRouteClass = AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
) => {
  const { captureMatches, renderMatches } = resolveFixedAudioEndpoints(
    devices,
    audioRouteClass
  )
  return {
    captureMatchCount: captureMatches.length,
    renderMatchCount: renderMatches.length,
    exactPairSelected:
      captureMatches.length === 1 && renderMatches.length === 1,
  }
}

export const validateRouteOptions = ({
  attemptCount,
  audioRouteClass,
  integratedPresentation = false,
}) => {
  if (!Number.isInteger(attemptCount) || attemptCount < 1 || attemptCount > 5) {
    throw new ControllerError(
      'prepared_sample_playback_controller_configuration_invalid'
    )
  }
  if (
    audioRouteClass !== AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT &&
    audioRouteClass !== AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
  ) {
    throw new ControllerError(
      'prepared_sample_playback_controller_configuration_invalid'
    )
  }
  const integratedRouteSelected =
    audioRouteClass === AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
  if (
    typeof integratedPresentation !== 'boolean' ||
    integratedPresentation !== integratedRouteSelected ||
    (attemptCount === INTEGRATED_ATTEMPT_COUNT) !== integratedRouteSelected
  ) {
    throw new ControllerError(
      'prepared_sample_playback_controller_configuration_invalid'
    )
  }
}

const completionStopSignal = (attemptCount) =>
  [
    '',
    'completed_exactly_one_attempt',
    'completed_exactly_two_attempts',
    'completed_exactly_three_attempts',
    'completed_exactly_four_attempts',
    'completed_exactly_five_attempts',
  ][attemptCount]

export const requireBrowserAudioAvailability = ({
  permissionAvailable,
  live,
  explicitDeviceSelected,
  inputCount,
  outputCount,
  audioRouteClass = AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
  captureMatchCount = 0,
  renderMatchCount = 0,
  sinkSelectionAvailable = true,
}) => {
  if (!permissionAvailable || inputCount < 1) {
    throw new ControllerError(
      'browser_microphone_permission_or_device_unavailable'
    )
  }
  if (audioRouteClass === AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR) {
    if (captureMatchCount !== 1 || renderMatchCount !== 1) {
      throw new ControllerError(
        'browser_audio_route_unavailable_or_ambiguous'
      )
    }
    if (!sinkSelectionAvailable) {
      throw new ControllerError('browser_audio_output_sink_unavailable')
    }
  }
  if (!live) {
    throw new ControllerError('browser_audio_input_track_not_live')
  }
  if (!explicitDeviceSelected) {
    throw new ControllerError('explicit_audio_input_device_required')
  }
  if (outputCount < 1) {
    throw new ControllerError('browser_audio_output_device_unavailable')
  }
}

export const selectBrowserAudioRoute = async (audioRouteClass) => {
  const integratedRouteClass = 'installed_virtual_cable_pair_v1'
  const captureLabel = 'CABLE Output (VB-Audio Virtual Cable)'
  const renderLabel = 'CABLE Input (VB-Audio Virtual Cable)'
  const acquiredTracks = []
  let cleanupIncomplete = false
  let selectedRouteInputMatched = audioRouteClass !== integratedRouteClass
  let availability = {
    permissionAvailable: false,
    live: false,
    explicitDeviceSelected: false,
    inputCount: 0,
    outputCount: 0,
    audioRouteClass,
    captureMatchCount: 0,
    renderMatchCount: 0,
    sinkSelectionAvailable: audioRouteClass !== integratedRouteClass,
  }
  const rememberTracks = (stream) => {
    for (const track of stream?.getTracks?.() ?? []) {
      if (!acquiredTracks.includes(track)) acquiredTracks.push(track)
    }
    for (const track of stream?.getAudioTracks?.() ?? []) {
      if (!acquiredTracks.includes(track)) acquiredTracks.push(track)
    }
  }
  const validDeviceId = (value) =>
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value)

  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    availability.permissionAvailable = true
    availability.inputCount = devices.filter(
      (device) => device.kind === 'audioinput'
    ).length
    availability.outputCount = devices.filter(
      (device) => device.kind === 'audiooutput'
    ).length

    let selectedTrack = null
    let selectedInputId = null
    if (audioRouteClass === integratedRouteClass) {
      const captureMatches = devices.filter(
        (device) =>
          device.kind === 'audioinput' &&
          device.label === captureLabel &&
          validDeviceId(device.deviceId)
      )
      const renderMatches = devices.filter(
        (device) =>
          device.kind === 'audiooutput' &&
          device.label === renderLabel &&
          validDeviceId(device.deviceId)
      )
      availability.captureMatchCount = captureMatches.length
      availability.renderMatchCount = renderMatches.length
      const AudioContextConstructor =
        globalThis.AudioContext ?? globalThis.webkitAudioContext
      availability.sinkSelectionAvailable =
        typeof AudioContextConstructor?.prototype?.setSinkId === 'function'
      if (captureMatches.length === 1 && renderMatches.length === 1) {
        const selectedStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: captureMatches[0].deviceId },
            echoCancellation: { exact: false },
            noiseSuppression: { exact: false },
            autoGainControl: { exact: false },
          },
        })
        rememberTracks(selectedStream)
        const exactTracks = selectedStream.getAudioTracks()
        selectedTrack = exactTracks.length === 1 ? exactTracks[0] : null
        selectedInputId = selectedTrack?.getSettings?.().deviceId
        if (
          selectedTrack?.readyState === 'live' &&
          selectedInputId === captureMatches[0].deviceId
        ) {
          selectedRouteInputMatched = true
          Object.defineProperty(window, '__preparedSampleSttAudioOutputDeviceId', {
            value: renderMatches[0].deviceId,
            writable: true,
            configurable: true,
            enumerable: false,
          })
        }
      }
    } else {
      const defaultStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      rememberTracks(defaultStream)
      const defaultTracks = defaultStream.getAudioTracks()
      selectedTrack = defaultTracks.length === 1 ? defaultTracks[0] : null
      selectedInputId = selectedTrack?.getSettings?.().deviceId
    }

    const live =
      selectedTrack?.kind === 'audio' && selectedTrack.readyState === 'live'
    const explicitDeviceSelected =
      live && validDeviceId(selectedInputId) && selectedRouteInputMatched
    if (explicitDeviceSelected) {
      Object.defineProperty(window, '__preparedSampleSttAudioInputDeviceId', {
        value: selectedInputId,
        writable: true,
        configurable: true,
        enumerable: false,
      })
    }
    availability.live = live
    availability.explicitDeviceSelected = explicitDeviceSelected
  } catch {
    // Native device details remain inside the temporary browser context.
  } finally {
    for (const track of new Set(acquiredTracks)) {
      try {
        track.stop()
      } catch {
        cleanupIncomplete = true
      }
    }
  }
  return { ...availability, cleanupIncomplete }
}

export const startBrowserRoutedPlayback = async ({
  audioUrl,
  maximumBytes,
  gainLinear,
}) => {
  if (window.__preparedSampleBrowserRoutedPlayer) {
    throw new Error('duplicate_final_or_playback_rejected')
  }
  const outputDeviceId = window.__preparedSampleSttAudioOutputDeviceId
  const validOutputDeviceId =
    typeof outputDeviceId === 'string' &&
    outputDeviceId.length > 0 &&
    outputDeviceId.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(outputDeviceId)
  const AudioContextConstructor =
    globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!validOutputDeviceId || !AudioContextConstructor) {
    throw new Error('browser_audio_output_sink_unavailable')
  }

  const audio = new Audio()
  const context = new AudioContextConstructor()
  const state = {
    audio,
    context,
    source: null,
    gain: null,
    objectUrl: null,
    exitClass: null,
    mediaElementCleanupAttempted: false,
    graphDisconnectAttempted: false,
    objectUrlRevokeAttempted: false,
    contextCloseAttempted: false,
    cleanupClass: null,
  }
  const release = async () => {
    if (state.cleanupClass === 'cleanup_incomplete') {
      throw new Error('cleanup_incomplete')
    }
    let cleanupFailed = false
    if (!state.mediaElementCleanupAttempted) {
      state.mediaElementCleanupAttempted = true
      try {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      } catch {
        cleanupFailed = true
      }
    }
    if (!state.graphDisconnectAttempted) {
      state.graphDisconnectAttempted = true
      try {
        state.source?.disconnect()
        state.gain?.disconnect()
      } catch {
        cleanupFailed = true
      }
    }
    if (state.objectUrl && !state.objectUrlRevokeAttempted) {
      state.objectUrlRevokeAttempted = true
      try {
        URL.revokeObjectURL(state.objectUrl)
        state.objectUrl = null
      } catch {
        cleanupFailed = true
      }
    }
    if (!state.contextCloseAttempted) {
      state.contextCloseAttempted = true
      try {
        await context.close()
      } catch {
        cleanupFailed = true
      }
    }
    if (cleanupFailed) {
      state.cleanupClass = 'cleanup_incomplete'
      throw new Error('cleanup_incomplete')
    }
    delete window.__preparedSampleBrowserRoutedPlayer
  }
  window.__preparedSampleBrowserRoutedPlayer = state

  try {
    if (typeof context.setSinkId !== 'function') {
      throw new Error('browser_audio_output_sink_unavailable')
    }
    try {
      await context.setSinkId(outputDeviceId)
    } catch {
      throw new Error('browser_audio_output_sink_selection_failed')
    }
    const response = await fetch(audioUrl, { cache: 'no-store' })
    if (!response.ok) throw new Error('playback_process_start_failed')
    const blob = await response.blob()
    if (blob.size < 1 || blob.size > maximumBytes) {
      throw new Error('prepared_sample_media_bounds_invalid')
    }
    state.objectUrl = URL.createObjectURL(blob)
    audio.preload = 'auto'
    audio.src = state.objectUrl
    state.source = context.createMediaElementSource(audio)
    state.gain = context.createGain()
    state.gain.gain.setValueAtTime(gainLinear, context.currentTime)
    state.source.connect(state.gain).connect(context.destination)
    audio.addEventListener(
      'ended',
      () => {
        state.exitClass = 'exit_zero'
      },
      { once: true }
    )
    audio.addEventListener(
      'error',
      () => {
        state.exitClass = 'exit_nonzero'
      },
      { once: true }
    )
    await context.resume()
    await audio.play()
    return { started: true }
  } catch (error) {
    try {
      await release()
    } catch (cleanupError) {
      throw cleanupError
    }
    throw error
  }
}

export const releaseBrowserRoutedPlayback = async () => {
  const state = window.__preparedSampleBrowserRoutedPlayer
  if (!state) return { exitClass: 'controlled_stop_after_result' }
  const priorExitClass = state.exitClass
  if (state.cleanupClass === 'cleanup_incomplete') {
    throw new Error('cleanup_incomplete')
  }
  let cleanupFailed = false
  if (!state.mediaElementCleanupAttempted) {
    state.mediaElementCleanupAttempted = true
    try {
      state.audio.pause()
      state.audio.removeAttribute('src')
      state.audio.load()
    } catch {
      cleanupFailed = true
    }
  }
  if (!state.graphDisconnectAttempted) {
    state.graphDisconnectAttempted = true
    try {
      state.source?.disconnect()
      state.gain?.disconnect()
    } catch {
      cleanupFailed = true
    }
  }
  if (state.objectUrl && !state.objectUrlRevokeAttempted) {
    state.objectUrlRevokeAttempted = true
    try {
      URL.revokeObjectURL(state.objectUrl)
      state.objectUrl = null
    } catch {
      cleanupFailed = true
    }
  }
  if (!state.contextCloseAttempted) {
    state.contextCloseAttempted = true
    try {
      await state.context.close()
    } catch {
      cleanupFailed = true
    }
  }
  if (cleanupFailed) {
    state.cleanupClass = 'cleanup_incomplete'
    throw new Error('cleanup_incomplete')
  }
  delete window.__preparedSampleBrowserRoutedPlayer
  return {
    exitClass: priorExitClass ?? 'controlled_stop_after_result',
  }
}

export const waitForAcceptedCandidateCompletion = async ({ page, timeoutMs }) => {
  try {
    await page.waitForFunction(
      () => {
        const state = window.__preparedSampleAtomicAttemptState
        return (
          state?.acceptedRequestCompletedCount >= 1 ||
          state?.acceptedRequestFailedCount >= 1 ||
          state?.duplicateRejectedCount >= 1
        )
      },
      undefined,
      { timeout: timeoutMs }
    )
  } catch {
    throw new ControllerError('accepted_candidate_request_not_completed')
  }
  const state = await page.evaluate(() => {
    const privateState = window.__preparedSampleAtomicAttemptState
    return {
      completed: privateState?.acceptedRequestCompletedCount ?? 0,
      failed: privateState?.acceptedRequestFailedCount ?? 0,
      duplicate: privateState?.duplicateRejectedCount ?? 0,
    }
  })
  if (state.completed !== 1 || state.failed !== 0) {
    throw new ControllerError('accepted_candidate_request_not_completed')
  }
  if (state.duplicate !== 0) {
    throw new ControllerError('duplicate_final_or_playback_rejected')
  }
  return { class: 'accepted_candidate_request_completed' }
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
  attemptCount = ATTEMPT_COUNT,
  audioRouteClass = AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
  integratedPresentation = false,
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
  const routeOutput = (overrides = {}) =>
    fixedOutput({
      controller_stop_signal: completionStopSignal(attemptCount),
      attempt_count: attemptCount,
      ...overrides,
    })

  try {
    validateRouteOptions({
      attemptCount,
      audioRouteClass,
      integratedPresentation,
    })
    await adapter.acquireLock()
    result = await withRouteTimeout(async (signal) => {
      await runRouteStep(signal, () => adapter.startServer({ signal }))
      await runRouteStep(signal, () => adapter.launchBrowser({ signal }))
      await runRouteStep(signal, () => adapter.requireLiveAudioInput())

      for (let attempt = 0; attempt < attemptCount; attempt += 1) {
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
        if (
          activePlayers.size !== 0 ||
          counts.playbackStart !== attempt ||
          counts.finalResults !== attempt
        ) {
          throw new ControllerError('duplicate_final_or_playback_rejected')
        }
        const player = await runRouteStep(signal, async () => {
          const startedPlayer = await adapter.startPlayback({ signal })
          activePlayers.add(startedPlayer)
          counts.playbackStart += 1
          return startedPlayer
        })

        const completedPlayer = await runRouteStep(signal, () =>
          adapter.waitForPlaybackCompletion(player, ATTEMPT_TIMEOUT_MS)
        )
        if (completedPlayer.exitClass !== 'exit_zero') {
          throw new ControllerError('playback_exit_nonzero')
        }
        counts.playbackExitZero += 1
        await runRouteStep(signal, () => adapter.finalizeRecognitionInput())

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
        if (
          playerResult.exitClass !== 'exit_zero' &&
          playerResult.exitClass !== 'controlled_stop_after_result'
        ) {
          throw new ControllerError('playback_exit_nonzero')
        }

        if (outcome.class !== 'final_result') {
          throw new ControllerError('browser_stt_no_final_result_before_timeout')
        }
        await runRouteStep(signal, () => adapter.recordFinalResult())
        await runRouteStep(signal, () =>
          adapter.waitForStatus(
            audioRouteClass ===
              AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
              ? 'attempt_recorded_or_accepted_candidate'
              : 'attempt_recorded',
            ATTEMPT_TIMEOUT_MS
          )
        )
        if (
          audioRouteClass ===
          AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
        ) {
          await runRouteStep(signal, () =>
            adapter.waitForAcceptedCandidateCompletion(ATTEMPT_TIMEOUT_MS)
          )
        }

        const after = await runRouteStep(signal, () =>
          adapter.readDiagnosticCounts()
        )
        const resultDelta = Math.max(0, after.resultCount - before.resultCount)
        const finalDelta = Math.max(0, after.finalCount - before.finalCount)
        if (finalDelta !== 1) {
          throw new ControllerError('duplicate_final_or_playback_rejected')
        }
        counts.resultEvents += resultDelta
        counts.finalResults += finalDelta
      }

      const summary = await runRouteStep(signal, () => adapter.readRunSummary())
      if (summary.attemptCount !== attemptCount) {
        throw new ControllerError('bounded_attempt_count_not_met')
      }
      if (attemptCount === ATTEMPT_COUNT && summary.stabilityClass !== 'stable_positive') {
        throw new ControllerError('repeat_content_match_not_stable')
      }
      if (
        audioRouteClass ===
        AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
      ) {
        await runRouteStep(signal, () => adapter.assertIntegratedCardinality())
      }

      return routeOutput({
        playback_start_count: counts.playbackStart,
        playback_exit_zero_count: counts.playbackExitZero,
        result_event_count: counts.resultEvents,
        final_result_count: counts.finalResults,
        content_match_stability_class:
          attemptCount === ATTEMPT_COUNT
            ? summary.stabilityClass
            : 'bounded_attempt_set_positive',
      })
    }, routeTimeoutMs, routeCancelSettleMs)
  } catch (error) {
    const resultClass =
      error instanceof ControllerError
        ? error.resultClass
        : 'prepared_sample_playback_controller_failed'
    const cleanupIncomplete = resultClass === 'cleanup_incomplete'
    result = routeOutput({
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
      result = routeOutput({
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
  const childEnvironment = {}
  const entries = Object.entries(source)
  for (const key of SAFE_PUBLIC_CHILD_ENV_KEYS) {
    const match = entries.find(
      ([candidate]) => candidate.toUpperCase() === key.toUpperCase()
    )
    if (
      match &&
      typeof match[1] === 'string' &&
      match[1].length > 0 &&
      match[1].length <= 32_767 &&
      !match[1].includes('\u0000')
    ) {
      childEnvironment[key] = match[1]
    }
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
      '  function Test-ExactNextDevCommand([string]$candidate) {',
      "    $tokenMatches=[regex]::Matches($candidate,'(?:\"([^\"]+)\"|(\\S+))')",
      "    $tokens=@($tokenMatches | ForEach-Object { if($_.Groups[1].Success){$_.Groups[1].Value}else{$_.Groups[2].Value} })",
      "    $devIndexes=@(for($index=0;$index -lt $tokens.Count;$index++){if($tokens[$index] -ceq 'dev'){$index}})",
      '    if($devIndexes.Count -ne 1 -or $devIndexes[0] -lt 1){return $false}',
      "    try{$modulePath=[IO.Path]::GetFullPath([string]$tokens[$devIndexes[0]-1])}catch{return $false}",
      "    $expectedModule=[IO.Path]::GetFullPath((Join-Path $root 'node_modules\\next\\dist\\bin\\next'))",
      '    $moduleOwned=[string]::Equals($modulePath,$expectedModule,[StringComparison]::OrdinalIgnoreCase)',
      "    $hostFlags=[regex]::Matches($candidate,'(?:^|\\s)(?:-H|--hostname)(?=\\s|=)')",
      "    $hostValue=[regex]::Matches($candidate,'(?:^|\\s)(?:-H|--hostname)\\s+127\\.0\\.0\\.1(?=\\s|$)')",
      `    $portFlags=[regex]::Matches($candidate,'(?:^|\\s)(?:-p|--port)(?=\\s|=)')`,
      `    $portValue=[regex]::Matches($candidate,'(?:^|\\s)(?:-p|--port)\\s+${port}(?=\\s|$)')`,
      "    return $moduleOwned -and $hostFlags.Count -eq 1 -and $hostValue.Count -eq 1 -and $portFlags.Count -eq 1 -and $portValue.Count -eq 1",
      '  }',
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
      `  $directOwned=($name -in @('node','node.exe')) -and $command.Contains($root + '\\') -and (Test-ExactNextDevCommand $command)`,
      `  $parentOwned=($parentName -in @('node','node.exe')) -and $parentCommand.Contains($root + '\\') -and (Test-ExactNextDevCommand $parentCommand)`,
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
    hasExited: () =>
      serverChild.exitCode !== null || serverChild.signalCode != null,
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
  attemptCount = ATTEMPT_COUNT,
  audioRouteClass = AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
  inspectOwner = inspectOperatorServerOwner,
  initialContext = null,
  initialPage = null,
}) => {
  let serverChild = null
  let context = initialContext
  let page = initialPage
  let profileDirectory = null
  let serverMode = 'none'
  let externalServerIdentity = null
  let browserPlaybackOrdinal = 0

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
        await page.evaluate(() => {
          const state = {
            attemptRecordedCount: 0,
            acceptedRequestPendingCount: 0,
            acceptedRequestCompletedCount: 0,
            acceptedRequestFailedCount: 0,
            duplicateRejectedCount: 0,
            lastStatus: '',
          }
          const observeStatus = () => {
            const status =
              document.querySelector(
                '[data-testid="prepared-sample-stt-status"]'
              )?.textContent ?? ''
            if (!status || status === state.lastStatus) return
            state.lastStatus = status
            if (status === 'attempt_recorded') state.attemptRecordedCount += 1
            if (status === 'accepted_candidate_request_pending') {
              state.acceptedRequestPendingCount += 1
            }
            if (status === 'accepted_candidate_request_completed') {
              state.acceptedRequestCompletedCount += 1
            }
            if (status === 'accepted_candidate_request_failed') {
              state.acceptedRequestFailedCount += 1
            }
            if (status === 'accepted_final_duplicate_rejected') {
              state.duplicateRejectedCount += 1
            }
          }
          const observer = new MutationObserver(observeStatus)
          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            characterData: true,
          })
          Object.defineProperty(window, '__preparedSampleAtomicAttemptState', {
            value: state,
            writable: true,
            configurable: true,
            enumerable: false,
          })
          Object.defineProperty(window, '__preparedSampleAtomicAttemptObserver', {
            value: observer,
            writable: true,
            configurable: true,
            enumerable: false,
          })
          observeStatus()
        })
      } catch (error) {
        if (signal?.aborted) throwIfRouteAborted(signal)
        throw new ControllerError('browser_launch_failed')
      }
    },
    async requireLiveAudioInput() {
      const result = await page.evaluate(selectBrowserAudioRoute, audioRouteClass)
      if (result.cleanupIncomplete) {
        throw new ControllerError('cleanup_incomplete')
      }
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
        if (status === 'attempt_recorded_or_accepted_candidate') {
          await page.waitForFunction(
            () => {
              const state = window.__preparedSampleAtomicAttemptState
              const attemptText = [...document.querySelectorAll('p')].find(
                (element) => element.textContent?.startsWith('Attempts:')
              )?.textContent
              const recordedAttemptCount = Number(
                attemptText?.match(/Attempts:\s*(\d+)\//)?.[1] ?? 0
              )
              return (
                state?.attemptRecordedCount >= 1 ||
                recordedAttemptCount >= 1
              )
            },
            undefined,
            { timeout: timeoutMs }
          )
          return
        }
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
    async waitForAcceptedCandidateCompletion(timeoutMs) {
      return waitForAcceptedCandidateCompletion({ page, timeoutMs })
    },
    async assertIntegratedCardinality() {
      const state = await page.evaluate(() => {
        const privateState = window.__preparedSampleAtomicAttemptState
        const attemptText = [...document.querySelectorAll('p')].find(
          (element) => element.textContent?.startsWith('Attempts:')
        )?.textContent
        return {
          recorded: Number(
            attemptText?.match(/Attempts:\s*(\d+)\//)?.[1] ?? 0
          ),
          pending: privateState?.acceptedRequestPendingCount ?? 0,
          completed: privateState?.acceptedRequestCompletedCount ?? 0,
          failed: privateState?.acceptedRequestFailedCount ?? 0,
          duplicate: privateState?.duplicateRejectedCount ?? 0,
        }
      })
      if (
        state.recorded !== 1 ||
        state.pending > 1 ||
        state.completed !== 1 ||
        state.failed !== 0 ||
        state.duplicate !== 0 ||
        browserPlaybackOrdinal !== 1 ||
        attemptCount !== INTEGRATED_ATTEMPT_COUNT
      ) {
        throw new ControllerError('duplicate_final_or_playback_rejected')
      }
    },
    async readDiagnosticCounts() {
      return page.evaluate(() => ({ ...window.__preparedSampleSttCounts }))
    },
    async startPlayback({ signal } = {}) {
      if (signal) throwIfRouteAborted(signal)
      if (!existsSync(audioPath)) {
        throw new ControllerError('playback_process_start_failed')
      }
      if (
        audioRouteClass ===
        AUDIO_ROUTE_CLASS_INSTALLED_VIRTUAL_CABLE_PAIR
      ) {
        if (browserPlaybackOrdinal !== 0) {
          throw new ControllerError('duplicate_final_or_playback_rejected')
        }
        let audioBytes = null
        let routeHandler = null
        let routeCleanupFailed = false
        try {
          const mediaStat = await stat(audioPath)
          if (
            !mediaStat.isFile() ||
            mediaStat.size < 1 ||
            mediaStat.size > MAX_PREPARED_SAMPLE_AUDIO_BYTES
          ) {
            throw new ControllerError('prepared_sample_media_bounds_invalid')
          }
          audioBytes = await readFile(audioPath)
          if (
            audioBytes.length !== mediaStat.size ||
            audioBytes.length > MAX_PREPARED_SAMPLE_AUDIO_BYTES
          ) {
            throw new ControllerError('prepared_sample_media_bounds_invalid')
          }
          routeHandler = async (route) => {
            await route.fulfill({
              status: 200,
              contentType: 'audio/mp4',
              body: audioBytes,
            })
          }
          await page.route(BROWSER_AUDIO_URL, routeHandler)
          await page.evaluate(startBrowserRoutedPlayback, {
            audioUrl: BROWSER_AUDIO_URL,
            maximumBytes: MAX_PREPARED_SAMPLE_AUDIO_BYTES,
            gainLinear: BROWSER_PLAYBACK_GAIN_LINEAR,
          })
          browserPlaybackOrdinal += 1
          return { kind: 'browser_routed', ordinal: browserPlaybackOrdinal }
        } catch (error) {
          for (const resultClass of [
            'browser_audio_output_sink_unavailable',
            'browser_audio_output_sink_selection_failed',
            'duplicate_final_or_playback_rejected',
            'prepared_sample_media_bounds_invalid',
          ]) {
            if (String(error?.message || '').includes(resultClass)) {
              throw new ControllerError(resultClass)
            }
          }
          throw error instanceof ControllerError
            ? error
            : new ControllerError('playback_process_start_failed')
        } finally {
          if (routeHandler) {
            try {
              await page.unroute(BROWSER_AUDIO_URL, routeHandler)
            } catch {
              routeCleanupFailed = true
            }
          }
          audioBytes?.fill(0)
          audioBytes = null
          routeHandler = null
          if (routeCleanupFailed) {
            throw new ControllerError('cleanup_incomplete')
          }
        }
      }
      if (!existsSync(ffplayPath)) {
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
          '-af',
          'volume=12dB',
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
    async waitForPlaybackCompletion(player, timeoutMs) {
      if (player.kind === 'browser_routed') {
        try {
          await page.waitForFunction(
            () =>
              window.__preparedSampleBrowserRoutedPlayer?.exitClass !== null,
            undefined,
            { timeout: timeoutMs }
          )
        } catch {
          throw new ControllerError('playback_exit_nonzero')
        }
        const exitClass = await page.evaluate(
          () => window.__preparedSampleBrowserRoutedPlayer?.exitClass ?? null
        )
        return { exitClass }
      }
      const completion = await Promise.race([
        player.exitPromise.then(() => player.exitClass),
        sleep(timeoutMs).then(() => 'timeout'),
      ])
      if (completion === 'timeout') {
        throw new ControllerError('playback_exit_nonzero')
      }
      return { exitClass: completion }
    },
    async finalizeRecognitionInput() {
      try {
        await page.evaluate(async () => {
          const finalize = window.__preparedSampleSttFinalizeAudioInput
          if (typeof finalize !== 'function') {
            throw new Error('prepared_sample_finalize_unavailable')
          }
          await finalize()
        })
      } catch {
        throw new ControllerError('prepared_sample_page_state_invalid')
      }
    },
    async stopPlayback(player) {
      if (player.kind === 'browser_routed') {
        try {
          return await page.evaluate(releaseBrowserRoutedPlayback)
        } catch {
          throw new ControllerError('cleanup_incomplete')
        }
      }
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
      const closingPage = page
      const closingContext = context
      let cleanupFailed = false
      try {
        if (closingPage) {
          try {
            await closingPage.evaluate(releaseBrowserRoutedPlayback)
          } catch {
            cleanupFailed = true
          }
          try {
            await closingPage.evaluate(() => {
              const privateWindow = window
              try {
                const cleanupClass =
                  privateWindow.__preparedSampleSttReleaseAudioTrack?.()
                if (
                  cleanupClass === 'explicit_audio_track_cleanup_failed'
                ) {
                  throw new Error('explicit_audio_track_cleanup_failed')
                }
              } finally {
                privateWindow.__preparedSampleAtomicAttemptObserver?.disconnect()
                delete privateWindow.__preparedSampleSttReleaseAudioTrack
                delete privateWindow.__preparedSampleSttAudioInputDeviceId
                delete privateWindow.__preparedSampleSttAudioOutputDeviceId
                delete privateWindow.__preparedSampleSttFinalizeAudioInput
                delete privateWindow.__preparedSampleAtomicAttemptObserver
                delete privateWindow.__preparedSampleAtomicAttemptState
                delete privateWindow.__preparedSampleBrowserRoutedPlayer
              }
            })
          } catch {
            cleanupFailed = true
          }
        }
        try {
          await closingContext?.close()
        } catch {
          cleanupFailed = true
        }
      } finally {
        context = null
        page = null
      }
      if (cleanupFailed) throw new ControllerError('cleanup_incomplete')
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
  const attemptCountText =
    process.env.SWORD_PREPARED_SAMPLE_ATTEMPT_COUNT || String(ATTEMPT_COUNT)
  const integratedPresentationText =
    process.env.SWORD_PREPARED_SAMPLE_INTEGRATED_PRESENTATION || ''
  const values = {
    operatorUrl: process.env.SWORD_PREPARED_SAMPLE_OPERATOR_URL || '',
    audioPath: process.env.SWORD_PREPARED_SAMPLE_AUDIO_PATH || '',
    expectedText: process.env.SWORD_PREPARED_SAMPLE_EXPECTED_TEXT || '',
    locale: process.env.SWORD_PREPARED_SAMPLE_LOCALE || '',
    ffplayPath: process.env.SWORD_PREPARED_SAMPLE_FFPLAY_PATH || '',
    lockClass: process.env.SWORD_PREPARED_SAMPLE_LOCK_CLASS || '',
    attemptCount: /^[1-5]$/.test(attemptCountText)
      ? Number(attemptCountText)
      : Number.NaN,
    audioRouteClass:
      process.env.SWORD_PREPARED_SAMPLE_AUDIO_ROUTE_CLASS ||
      AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT,
    integratedPresentation:
      integratedPresentationText === 'true'
        ? true
        : integratedPresentationText === 'false'
          ? false
          : null,
  }
  if (!values.operatorUrl || !values.audioPath || !values.expectedText) {
    throw new ControllerError(
      'prepared_sample_expected_text_authority_missing_or_invalid'
    )
  }
  if (!values.locale || !values.lockClass) {
    throw new ControllerError('prepared_sample_playback_dependency_unavailable')
  }
  validateRouteOptions(values)
  if (
    values.audioRouteClass === AUDIO_ROUTE_CLASS_SYSTEM_DEFAULT &&
    !values.ffplayPath
  ) {
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
      attemptCount: privateValues.attemptCount,
      audioRouteClass: privateValues.audioRouteClass,
      integratedPresentation: privateValues.integratedPresentation,
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
