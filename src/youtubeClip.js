// A song's own music video, set by hand in its Edit Track window: always a
// YouTube link, with the seconds it loops between in the side panel's
// Visualization + Lyrics tab (without both it isn't shown there).

const VIDEO_ID = /^[\w-]{11}$/

/** The video id of a YouTube link (watch, youtu.be, shorts, embed, music), else null. */
export function youtubeVideoId(link) {
  let url
  try { url = new URL(String(link || '').trim()) } catch { return null }
  if (!/^https?:$/.test(url.protocol)) return null
  const host = url.hostname.replace(/^(?:www\.|m\.|music\.)/, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    id = parts[0] === 'watch' ? url.searchParams.get('v')
      : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : null
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** { videoId, start, end } for a song whose music video can loop, else null. */
export function trackClipLoop(track) {
  const videoId = youtubeVideoId(track?.clip_url)
  const start = Number(track?.clip_start)
  const end = Number(track?.clip_end)
  if (!videoId || track?.clip_start == null || track?.clip_end == null || !Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end <= start) return null
  return { videoId, start, end }
}
