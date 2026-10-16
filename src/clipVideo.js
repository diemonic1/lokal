// A song's own video, set by hand in its Edit Track window: any link Lokal
// can play the picture of (YouTube, a site yt-dlp knows, a video file on the
// web) or a video file on this computer, with the seconds it loops between in
// the side panel's Visualization + Lyrics tab (without both it isn't shown
// there). Where it plays from is worked out by the main process
// (electron/online/clipVideo.js).

const LOCAL_PATH = /^(?:[a-z]:[\\/]|\\\\|file:\/\/)/i

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

/** { link, start, end } for a song whose video can loop, else null. */
export function trackClipLoop(track) {
  const link = clipVideoLink(track?.clip_url)
  const start = Number(track?.clip_start)
  const end = Number(track?.clip_end)
  if (!link || track?.clip_start == null || track?.clip_end == null || !Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end <= start) return null
  return { link, start, end }
}
