// Loudness normalization: songs' measured loudness ({ lufs, peakDb }, or null
// when it can't be measured), asked of the main process once each
// (electron/loudness.js keeps it in the database between launches).
import { api } from '../api'

/**
 * The DynamicsCompressor after the decks as a peak limiter (normalization on),
 * or let through untouched (off: a 1:1 ratio compresses nothing).
 */
export function configureLimiter(node, on) {
  if (!node) return
  const at = node.context?.currentTime || 0
  const setTo = (param, value) => { try { param.setValueAtTime(value, at) } catch { param.value = value } }
  setTo(node.threshold, on ? -1.5 : 0)
  setTo(node.knee, 0)
  setTo(node.ratio, on ? 20 : 1)
  setTo(node.attack, 0.002)
  setTo(node.release, 0.15)
}

const cache = new Map() // track id -> Promise<{ lufs, peakDb } | null>

/** The song's measured loudness (a promise; it never rejects). */
export function measureLoudness(track) {
  const id = track?.id == null ? '' : String(track.id)
  if (!id) return Promise.resolve(null)
  if (cache.has(id)) return cache.get(id)
  const pending = Promise.resolve()
    .then(() => api.measureLoudness?.({ id: track.id, file_path: track.file_path }))
    .then(result => (Number.isFinite(result?.lufs) ? result : null))
    .catch(() => null)
  cache.set(id, pending)
  // Not measured (no file yet, no ffmpeg): asked again next time.
  pending.then(result => { if (!result) cache.delete(id) })
  if (cache.size > 500) cache.delete(cache.keys().next().value)
  return pending
}
