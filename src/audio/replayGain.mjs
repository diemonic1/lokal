export function normalizeReplayGainMode(value) {
  return ['off', 'track', 'album'].includes(value) ? value : 'off'
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/** Whether the tags hold a gain `mode` would use. */
export function hasReplayGain(tags, mode) {
  mode = normalizeReplayGainMode(mode)
  if (mode === 'off' || !tags) return false
  return finiteNumber(mode === 'album' ? tags.albumGainDb ?? tags.trackGainDb : tags.trackGainDb) !== null
}

// ReplayGain levels songs to -18 LUFS; loudness normalization's target can be
// another, and songs with tags and without must come out equally loud.
export const REPLAYGAIN_REFERENCE_LUFS = -18
// Measured songs are boosted at most this much (a quiet recording's noise and
// hiss come up with it); the limiter after the gain catches the peaks.
export const MAX_BOOST_DB = 9
export const MAX_CUT_DB = 24

/**
 * The gain bringing a song to `target` LUFS: from its ReplayGain tags (when
 * `mode` uses them and they're there), else from its measured loudness
 * ({ lufs, peakDb }), else 1. `target` null: ReplayGain only, as it was.
 */
export function normalizedMultiplier({ tags, mode, measured, target }) {
  if (target == null) return hasReplayGain(tags, mode) ? replayGainMultiplier(tags, mode) : 1
  // With normalization on, a song's tags stand for a measurement (gain = -18 -
  // LUFS; Lokal writes them from its own) and get the same limits, so a song
  // plays as loud before and after its tags were written.
  if (hasReplayGain(tags, mode)) measured = replayGainAsMeasured(tags, mode)
  if (!Number.isFinite(measured?.lufs)) return 1
  let gainDb = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, target - measured.lufs))
  // A boost doesn't push the peaks more than 6 dB past full scale (the limiter
  // can take that much without being heard).
  if (gainDb > 0 && Number.isFinite(measured.peakDb)) gainDb = Math.min(gainDb, Math.max(0, 6 - measured.peakDb))
  return Math.pow(10, gainDb / 20)
}

/** The tags' gain (track or album, as `mode` says) as { lufs, peakDb }. */
function replayGainAsMeasured(tags, mode) {
  const albumGain = finiteNumber(tags.albumGainDb)
  const useAlbum = normalizeReplayGainMode(mode) === 'album' && albumGain !== null
  const gainDb = useAlbum ? albumGain : finiteNumber(tags.trackGainDb)
  const peak = (useAlbum ? finiteNumber(tags.albumPeak) : null) ?? finiteNumber(tags.trackPeak)
  return { lufs: REPLAYGAIN_REFERENCE_LUFS - gainDb, peakDb: peak !== null && peak > 0 ? 20 * Math.log10(peak) : null }
}

export function replayGainMultiplier(tags, mode) {
  mode = normalizeReplayGainMode(mode)
  if (mode === 'off' || !tags) return 1

  const albumGain = finiteNumber(tags.albumGainDb)
  const useAlbum = mode === 'album' && albumGain !== null
  const gainDb = useAlbum ? albumGain : finiteNumber(tags.trackGainDb)
  if (gainDb === null) return 1

  let multiplier = Math.pow(10, gainDb / 20)
  const albumPeak = useAlbum ? finiteNumber(tags.albumPeak) : null
  const peak = albumPeak ?? finiteNumber(tags.trackPeak)
  if (peak !== null && peak > 0) multiplier = Math.min(multiplier, 0.999 / peak)
  return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1
}
