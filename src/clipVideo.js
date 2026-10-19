// A song's own video, set by hand in its Edit Track window: any link Lokal
// can play the picture of (YouTube, a site yt-dlp knows, a video file on the
// web) or a video file on this computer, looped (muted) in the side panel's
// Visualization + Lyrics tab. Where it plays from is worked out by the main
// process (electron/online/clipVideo.js).
// The part that loops, in seconds (typed as 75, 1:15, 1:02:03 or 0:11.5):
//   both times      that part;
//   only the start  10 seconds from it (or to the video's end);
//   only the end    the 10 seconds before it;
//   neither         the whole video, start to end.
// A part at least SEEK_MIN long follows the song: the video is at the part's
// start plus the song's time, going round the part again when the song is
// longer than it (see clipSongTime), so seeking the song seeks the video.

const LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\|file:\/\/)/i
const SHORT_LOOP = 10
export const SEEK_MIN = 20

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

/** A time field as typed: a "." stays (a fraction of a second, one at a time), anything else but a digit becomes ":" (one at a time). */
export function clipTimeInput(text) {
  return String(text || '').replace(/[^0-9.]+/g, ':').replace(/\.+/g, '.')
}

/** "75", "1:15", "1:02:03", "0:11.5" -> seconds; '' -> null; NaN when it can't be read (a fraction only in the seconds). */
export function parseClipTime(text) {
  const value = clipTimeInput(text).replace(/^:+|:+$/g, '')
  if (!value) return null
  const parts = value.split(':')
  if (parts.length > 3 || parts.some((part, i) => !(i === parts.length - 1 ? /^(?:\d+\.?\d*|\.\d+)$/ : /^\d+$/).test(part))) return NaN
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0)
}

/** Seconds as the field shows them: "1:15", "1:02:03", "0:11.5" (to the millisecond); null -> ''. */
export function formatClipTime(seconds) {
  if (seconds == null || seconds === '' || !Number.isFinite(Number(seconds))) return ''
  const ms = Math.max(0, Math.round(Number(seconds) * 1000))
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const fraction = ms % 1000 ? `.${String(ms % 1000).padStart(3, '0').replace(/0+$/, '')}` : ''
  const s = String(total % 60).padStart(2, '0') + fraction
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const timeOf = value => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value)))

export const CLIP_ZOOM_MAX = 100

// The video being tried in Edit Track, shown at once: trackId -> { link,
// start, end, zoom } while the window is open, gone when it closes (saved or
// not).
const clipPreviews = new Map()
const previewListeners = new Set()

/** Show `clip` ({ url, start, end, zoom } as typed) as the video of `trackId` for now; null ends the preview. */
export function previewClip(trackId, clip) {
  if (trackId == null) return
  const key = String(trackId)
  if (clip == null) { if (!clipPreviews.delete(key)) return }
  else {
    const time = value => { const n = parseClipTime(value); return Number.isNaN(n) ? null : n }
    clipPreviews.set(key, { link: clipVideoLink(clip.url), start: time(clip.start), end: time(clip.end), zoom: clipZoomPercent(clip.zoom) })
  }
  previewListeners.forEach(listener => listener())
}

/** The video being tried for this song ({ link, start, end, zoom }; link null: none), or null. */
export function clipPreview(trackId) {
  return trackId == null ? null : clipPreviews.get(String(trackId)) ?? null
}

/** Calls `listener` whenever a preview starts, changes or ends. -> unsubscribe */
export function onClipPreview(listener) {
  previewListeners.add(listener)
  return () => { previewListeners.delete(listener) }
}

/** The zoom as a whole percent, 0-100 (anything else: 0). */
export function clipZoomPercent(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(0, Math.min(CLIP_ZOOM_MAX, n)) : 0
}

/** { link, start, end, zoom } for a song with a video (either time may be null: see clipRange; zoom 0-100 %). */
export function trackClipLoop(track) {
  const link = clipVideoLink(track?.clip_url)
  if (!link) return null
  return { link, start: timeOf(track?.clip_start), end: timeOf(track?.clip_end), zoom: clipZoomPercent(track?.clip_zoom) }
}

/** The seconds that loop, once the video's length is known (Infinity / NaN: unknown). */
export function clipRange(start, end, duration) {
  const length = Number.isFinite(duration) && duration > 0 ? duration : null
  const cap = value => (length ? Math.min(value, length) : value)
  if (start != null && end != null && end > start) return { start, end: cap(end) }
  if (start != null) return { start: cap(start), end: cap(start + SHORT_LOOP) }
  if (end != null) return { start: Math.max(0, cap(end) - SHORT_LOOP), end: cap(end) }
  return { start: 0, end: length ?? Infinity }
}

/** Where the video should be at `songTime` (seconds) for the part `range` ({ start, end }), or null when the part is too short to follow the song. */
export function clipSongTime(range, songTime) {
  const length = range.end - range.start
  if (!Number.isFinite(length) || length < SEEK_MIN || !Number.isFinite(songTime)) return null
  return range.start + (Math.max(0, songTime) % length)
}
