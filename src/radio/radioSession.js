// Online radio playback: icecast-metadata-player plays the station through the
// app's own <audio> element (so the EQ, volume and analyser keep working),
// buffers before starting, reads the ICY metadata and reports each title
// change when it is actually heard (after the buffer).
//
// The player owns the element while a station plays: pausing the element
// stops the stream, playing it reconnects live. release() hands it back
// clean before an ordinary song takes the element again.

import IcecastMetadataPlayer from 'icecast-metadata-player'

let session = null
let generation = 0

/** The station playing (or set to play), or null. */
export function radioTrackId() {
  return session?.trackId ?? null
}

/** MP3 / AAC / ... from what the codec parser reports. */
function codecName(info) {
  if (!info) return ''
  if (info.layer) return String(info.layer).includes('III') ? 'MP3' : `MPEG ${info.layer}`
  if (info.profile) return 'AAC'
  if (info.vendor || info.preSkip != null) return 'Opus'
  if (info.bitDepth && info.streamInfo) return 'FLAC'
  return ''
}

/**
 * A short phrase (English key, translated where shown) for what went wrong
 * while connecting, or null for nothing worth showing (a cancelled request).
 */
export function radioIssue(name, error) {
  const text = `${name || ''} ${error?.name || ''} ${error?.message || ''}`
  if (/AbortError/i.test(text)) return null
  const status = Number(/\b(\d{3}) received from\b/.exec(error?.message || '')?.[1])
  if (status === 404 || status === 410) return { key: 'Station not found ({status})', status }
  if (status === 401 || status === 403) return { key: 'Access denied ({status})', status }
  if (status >= 500) return { key: 'Server error ({status})', status }
  if (status) return { key: 'Server answered {status}', status }
  if (/body stream/i.test(text)) return { key: 'Stream interrupted' }
  if (/NotSupported|codec|decode|format|mime|MediaError|Unsupported/i.test(text)) return { key: 'Unsupported stream' }
  if (/network|fetch|offline|TypeError|Load failed|CORS/i.test(text)) return { key: 'No connection' }
  return { key: 'Playback error' }
}

/**
 * Stop the station and give the element back: no source, not looping (the
 * player leaves a looping silent clip on it to keep the play button usable).
 */
export async function releaseRadio() {
  const current = session
  if (!current) return
  session = null
  generation++
  try { await current.player.detachAudioElement() } catch {}
  const el = current.el
  try {
    el.loop = false
    el.pause()
    el.removeAttribute('src')
    el.srcObject = null
    el.load()
  } catch {}
}

/**
 * Play `track` (a station entry, src/radio/stations.js) on `el`.
 *   bufferSec  seconds of audio gathered before it starts (0: none)
 *   autoplay   start now (otherwise on the next playRadio())
 *   handlers   { onTitle(text, audioTime), onStreamInfo({bitrate, codec}),
 *                onBuffering(bool), onFailed(message), onLog(message, level),
 *                onIssue({ key, status, detail } | null, fatal) }
 */
export async function startRadio(el, track, { bufferSec = 3, autoplay = true, handlers = {} } = {}) {
  await releaseRadio()
  const mine = ++generation
  const live = () => generation === mine && session?.trackId === track.id
  const log = (message, level = 'info') => handlers.onLog?.(`[radio] ${track.title}: ${message}`, level)
  el.loop = false
  const player = new IcecastMetadataPlayer(track.stream_url, {
    audioElement: el,
    metadataTypes: ['icy'],
    bufferLength: Math.max(0, Number(bufferSec) || 0),
    retryTimeout: 60,
    retryDelayMin: 1,
    retryDelayMax: 8,
    icyDetectionTimeout: 4000,
    enableLogging: false,
    onLoad: () => { if (live()) handlers.onBuffering?.(true) },
    onBuffer: () => { if (live()) handlers.onBuffering?.(true) },
    onPlay: () => { if (live()) { handlers.onBuffering?.(false); handlers.onIssue?.(null, false); log(`playing (${player.playbackMethod || '?'}, buffer ${bufferSec}s)`) } },
    onMetadata: (metadata) => {
      if (!live()) return
      const text = metadata?.StreamTitle
      if (text != null) handlers.onTitle?.(String(text), el.currentTime)
    },
    onCodecUpdate: (info) => {
      if (!live()) return
      handlers.onStreamInfo?.({ bitrate: Number(info?.bitrate) || null, codec: codecName(info) })
    },
    onRetry: () => { if (live()) { handlers.onBuffering?.(true); log('reconnecting', 'warn') } },
    onRetryTimeout: () => {
      if (!live()) return
      handlers.onBuffering?.(false)
      handlers.onIssue?.({ key: 'No response' }, true)
      handlers.onFailed?.('The station stopped responding.')
    },
    onWarn: (...messages) => { if (live()) log(messages.join(' '), 'warn') },
    onError: (message, error) => {
      if (!live()) return
      const detail = `${message}${error?.message ? ` (${error.message})` : ''}`
      log(detail, 'warn')
      const issue = radioIssue(message, error)
      if (!issue) return
      handlers.onIssue?.({ ...issue, detail }, false)
      // Not a network trouble it retries: the player has stopped for good.
      setTimeout(() => {
        if (!live() || !['stopped', 'stopping'].includes(player.state)) return
        handlers.onBuffering?.(false)
        handlers.onIssue?.({ ...issue, detail }, true)
        handlers.onFailed?.(issue.key, issue)
      }, 0)
    },
  })
  session = { player, el, trackId: track.id }
  if (autoplay) await playRadio()
}

/** Start (or reconnect, after a pause) the current station. */
export async function playRadio() {
  const current = session
  if (!current) return
  if (current.player.state === 'stopped') {
    try { await current.player.play() } catch {}
  } else if (current.el.paused) {
    try { await current.el.play() } catch {}
  }
}

/** Pause = stop the stream (it's live: resuming starts from now). */
export function pauseRadio() {
  const current = session
  if (!current) return
  try { current.el.pause() } catch {}
}
