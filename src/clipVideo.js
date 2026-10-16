// A song's own video, set by hand in its Edit Track window: any link Lokal
// can play the picture of (YouTube, a site yt-dlp knows, a video file on the
// web) or a video file on this computer, looped (muted) in the side panel's
// Visualization + Lyrics tab. Where it plays from is worked out by the main
// process (electron/online/clipVideo.js).
// The part that loops, in seconds (typed as 75, 1:15 or 1:02:03):
//   both times      that part;
//   only the start  10 seconds from it (or to the video's end);
//   only the end    the 10 seconds before it;
//   neither         the video's middle third (60-120 s of a 3-minute one).

const LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\|file:\/\/)/i
const SHORT_LOOP = 10

/** The link or path when it can be a video, else null. */
export function clipVideoLink(text) {
  const value = String(text || '').trim()
  if (!value) return null
  if (LOCAL_PATH.test(value)) return value
  try {
    const url = new URL(value)
    return /^https?:$/.test(url.protocol) ? url.href : null
  } catch { return null }
}

/** The address that opens it outside Lokal (a browser, the video player). */
export function clipOpenUrl(text) {
  const value = clipVideoLink(text)
  if (!value || /^(?:https?|file):/i.test(value)) return value
  const path = value.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/').replace(/%3A/g, ':')
  return path.startsWith('//') ? `file:${path}` : `file:///${path}`
}

/** A time field as typed: anything but a digit becomes ":" (one at a time). */
export function clipTimeInput(text) {
  return String(text || '').replace(/[^0-9]+/g, ':')
}

/** "75", "1:15", "1:02:03" -> seconds; '' -> null; NaN when it can't be read. */
export function parseClipTime(text) {
  const value = clipTimeInput(text).replace(/^:+|:+$/g, '')
  if (!value) return null
  const parts = value.split(':').map(Number)
  if (parts.length > 3 || parts.some(n => !Number.isFinite(n))) return NaN
  return parts.reduce((total, n) => total * 60 + n, 0)
}

/** Seconds as the field shows them: "1:15", "1:02:03"; null -> ''. */
export function formatClipTime(seconds) {
  if (seconds == null || seconds === '' || !Number.isFinite(Number(seconds))) return ''
  const total = Math.max(0, Math.round(Number(seconds)))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const timeOf = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value)))

/** { link, start, end } for a song with a video (either time may be null: see clipRange). */
export function trackClipLoop(track) {
  const link = clipVideoLink(track?.clip_url)
  if (!link) return null
  return { link, start: timeOf(track?.clip_start), end: timeOf(track?.clip_end) }
}

/** The seconds that loop, once the video's length is known (Infinity / NaN: unknown). */
export function clipRange(start, end, duration) {
  const length = Number.isFinite(duration) && duration > 0 ? duration : null
  const cap = value => (length ? Math.min(value, length) : value)
  if (start != null && end != null && end > start) return { start, end: cap(end) }
  if (start != null) return { start: cap(start), end: cap(start + SHORT_LOOP) }
  if (end != null) return { start: Math.max(0, cap(end) - SHORT_LOOP), end: cap(end) }
  return length ? { start: length / 3, end: (length * 2) / 3 } : { start: 0, end: Infinity }
}
