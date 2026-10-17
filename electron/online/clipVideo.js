// The video set by hand for a song in its Edit Track window (the side panel's
// Visualization + Lyrics tab loops a part of it, muted): where its picture
// plays from. Any video Lokal can reach:
//   - a file on this computer (a path, or a file:// link);
//   - a YouTube video: Lokal's own video stream (see ../ipc/online.js), or,
//     when that can't play it (an age-restricted video, say), the direct link
//     yt-dlp finds with the cookies set up in Settings;
//   - a link straight to a video file (.mp4, .webm...);
//   - a page of any site yt-dlp knows (Vimeo, VK, Twitter, Reddit...): the
//     direct link to its picture (a plain HTTP stream the player can read).
// Direct links are kept a while (they stop working after some hours).

const fs = require('fs')
const { spawn } = require('child_process')
const { pathToFileURL, fileURLToPath } = require('url')
const { cookieArgs } = require('../ipc/ytCookies')
const { jsRuntime } = require('./jsRuntime')

const VIDEO_FILE = /\.(?:mp4|m4v|webm|mov|mkv|ogv|ogg)$/i
const VIDEO_ID = /^[\w-]{11}$/
const YTDLP_TIMEOUT_MS = 60000
const FOUND_TTL_MS = 2 * 60 * 60 * 1000
const FAILED_TTL_MS = 5 * 60 * 1000
const remembered = new Map() // link -> { at, result }

/** The video id of a YouTube link (watch, youtu.be, shorts, embed, music), else null. */
function youtubeVideoId(url) {
  const host = url.hostname.replace(/^(?:www\.|m\.|music\.)/, '')
  let id = null
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    id = parts[0] === 'watch' ? url.searchParams.get('v') : ['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : null
  }
  return id && VIDEO_ID.test(id) ? id : null
}

/** A path on this computer, from "C:\...", "\\server\...", "/..." or file://; else null. */
function localPath(text) {
  if (/^file:\/\//i.test(text)) { try { return fileURLToPath(text) } catch { return null } }
  if (/^[a-z]:[\\/]/i.test(text) || /^\\\\/.test(text) || (process.platform !== 'win32' && text.startsWith('/'))) return text
  return null
}

// The best picture without HLS/DASH manifests (the player only reads plain
// HTTP files): video-only is fine, the clip plays muted.
const FORMAT = 'bv*[protocol^=http][height<=1080]/b[protocol^=http][height<=1080]/bv*[protocol^=http]/b[protocol^=http]/b'

function ytdlpDirectLink(link, { ytdlp, settings, spawnImpl = spawn, timeoutMs = YTDLP_TIMEOUT_MS }) {
  if (!ytdlp) return Promise.resolve({ error: 'yt-dlp is not installed' })
  const cookies = cookieArgs(settings || {}, { url: link })
  const youtube = /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(new URL(link).hostname)
  const runtime = youtube ? jsRuntime() : { args: [], options: {} }
  const args = ['-g', '-f', FORMAT, '--no-playlist', '--no-warnings', ...cookies.args, ...runtime.args, '--', link]
  return new Promise((resolve) => {
    let proc
    try { proc = spawnImpl(ytdlp, args, { windowsHide: true, ...runtime.options }) } catch (error) { resolve({ error: error.message }); return }
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, timeoutMs)
    proc.stdout.on('data', d => { if (stdout.length < 200000) stdout += d.toString() })
    proc.stderr?.on('data', d => { if (stderr.length < 20000) stderr += d.toString() })
    proc.on('error', (error) => { clearTimeout(timer); resolve({ error: error.message }) })
    proc.on('close', () => {
      clearTimeout(timer)
      const src = stdout.split(/\r?\n/).map(line => line.trim()).find(line => /^https?:\/\//i.test(line))
      if (src) resolve({ src })
      else resolve({ error: (stderr.match(/ERROR:\s*(.+)/)?.[1] || stderr.trim() || 'No video found at that link').slice(0, 300) })
    })
  })
}

/**
 * { src } for the player, or { error }.
 * @param fallback  the first address didn't play: a YouTube video goes through yt-dlp instead
 */
async function resolveClipVideo(link, { fallback = false, ytdlp = null, settings = {}, streamBase = null, now = Date.now } = {}) {
  const text = String(link || '').trim()
  if (!text) return { error: 'No video' }
  const file = localPath(text)
  if (file) return fs.existsSync(file) ? { src: pathToFileURL(file).href, local: true } : { error: 'File not found' }
  let url
  try { url = new URL(text) } catch { return { error: 'Not a link' } }
  if (!/^https?:$/.test(url.protocol)) return { error: 'Not a web link' }

  const videoId = youtubeVideoId(url)
  if (videoId && !fallback && streamBase) {
    const base = await Promise.resolve(streamBase()).catch(() => null)
    return { src: base ? `${base}/ytv/${encodeURIComponent(videoId)}` : `lokal-stream://ytv/${encodeURIComponent(videoId)}`, youtube: true }
  }
  if (!videoId && VIDEO_FILE.test(url.pathname)) return { src: url.href }

  // Signing in to YouTube (or changing the cookies) asks again at once: an
  // age-restricted video refused without an account may play with one.
  const account = `${settings.yt_cookies === '1' ? settings.yt_cookie_browser || 'paste' : 'none'}:${settings.yt_account_revision || ''}`
  const key = `${videoId ? `yt:${videoId}` : url.href}|${account}`
  const kept = remembered.get(key)
  if (kept && now() - kept.at < (kept.result.src ? FOUND_TTL_MS : FAILED_TTL_MS)) return kept.result
  const result = await ytdlpDirectLink(videoId ? `https://www.youtube.com/watch?v=${videoId}` : url.href, { ytdlp, settings })
  remembered.set(key, { at: now(), result })
  if (remembered.size > 100) remembered.delete(remembered.keys().next().value)
  return result
}

// Edit Track's "available / not available" badge next to the video link:
// whether the video is still there. A file: on this computer; YouTube: its
// oEmbed answers 404/400 for a removed or wrong video (401 is a video that
// exists but can't be embedded, still playable); any other link: what the
// site answers (404, 410... is gone). { ok: true|false|null, status, reason }
// -- null when the check itself couldn't be made (no internet, timeout).
const CHECK_TIMEOUT_MS = 12000
const CHECK_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function requestStatus(url, method, fetchImpl) {
  const response = await fetchImpl(url, {
    method, redirect: 'follow', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    headers: { 'User-Agent': CHECK_UA, Accept: '*/*', ...(method === 'GET' ? { Range: 'bytes=0-0' } : {}) },
  })
  try { await response.body?.cancel?.() } catch {}
  return response.status
}

async function checkClipLink(link, { fetchImpl = globalThis.fetch } = {}) {
  const text = String(link || '').trim()
  if (!text) return { ok: null, reason: 'No video' }
  const file = localPath(text)
  if (file) return fs.existsSync(file) ? { ok: true } : { ok: false, reason: 'File not found' }
  let url
  try { url = new URL(text) } catch { return { ok: false, reason: 'Not a link' } }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: 'Not a web link' }
  try {
    const videoId = youtubeVideoId(url)
    if (videoId) {
      const watch = `https://www.youtube.com/watch?v=${videoId}`
      const status = await requestStatus(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, 'GET', fetchImpl)
      if (status < 300 || status === 401 || status === 403) return { ok: true, status }
      return { ok: false, status, reason: status === 404 || status === 400 ? 'Video not found' : `HTTP ${status}` }
    }
    let status = await requestStatus(url.href, 'HEAD', fetchImpl)
    // Some sites refuse HEAD (405, 403...): ask for the first byte instead.
    if (status >= 400 && status !== 404 && status !== 410) status = await requestStatus(url.href, 'GET', fetchImpl)
    return status < 400 ? { ok: true, status } : { ok: false, status, reason: `HTTP ${status}` }
  } catch (e) {
    return { ok: null, reason: e?.name === 'TimeoutError' ? 'No answer' : (e?.cause?.code || e?.message || 'Network error') }
  }
}

module.exports = { resolveClipVideo, checkClipLink, youtubeVideoId, localPath }
