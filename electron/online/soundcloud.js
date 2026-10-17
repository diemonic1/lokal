// SoundCloud as an online source, through the user's own yt-dlp (SoundCloud
// has no open API): search with `scsearch`, stream the progressive MP3.
// Tracks behind SoundCloud Go+ only give a 30-second preview; those are
// flagged so the UI can say so.
// Most tracks no longer have the progressive MP3 at all, only HLS (AAC in
// fragmented MP4, ten-second pieces): the pieces are fetched together and
// joined into one file in the playback cache, which then plays (and seeks)
// like any file.

const fs = require('fs')
const fsp = require('fs/promises')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const TRACK_ID = /^\d{1,20}$/
const SEARCH_TTL_MS = 10 * 60 * 1000
const STREAM_TTL_MS = 20 * 60 * 1000
const RUN_TIMEOUT_MS = 30000
const HLS_PIECE_TIMEOUT_MS = 20000
const HLS_PARALLEL = 6
// The progressive MP3 when there is one (it streams at once), else HLS; the
// 30-second Go+ preview only when nothing full is offered.
const FORMAT = [
  'http_mp3_1_0', 'bestaudio[protocol=http][format_id!*=preview]', 'bestaudio[protocol=https][format_id!*=preview]',
  'hls_aac_160k', 'hls_aac_96k', 'hls_mp3_1_0', 'bestaudio[protocol=m3u8_native][format_id!*=preview][ext=m4a]',
  'bestaudio[protocol=m3u8_native][format_id!*=preview][ext=mp3]', 'http_mp3_0_0_preview', 'bestaudio',
].join('/')

const searchCache = new Map() // query -> { at, results }
const streamCache = new Map() // id -> { url, headers, mime, expiresAt, preview }
const resolving = new Map()   // id -> Promise

/** The canonical yt-dlp URL for a SoundCloud track id. */
function trackUrl(id) {
  return `https://api.soundcloud.com/tracks/${id}`
}

/** A SoundCloud track id from an api.soundcloud.com URL (plain or "soundcloud:tracks:" form). */
function idFromUrl(url) {
  const m = String(url || '').match(/api\.soundcloud\.com\/tracks\/(?:soundcloud(?:%3A|:)tracks(?:%3A|:))?(\d+)/i)
  return m ? m[1] : null
}

/** Run yt-dlp and parse its JSON output (last line). */
function runJson(ytdlp, args) {
  return new Promise((resolve, reject) => {
    let proc
    try { proc = spawn(ytdlp, args, { windowsHide: true }) } catch (e) { reject(new Error(`Could not run yt-dlp (${e.message})`)); return }
    let out = ''
    let err = ''
    const timer = setTimeout(() => { try { proc.kill() } catch {} }, RUN_TIMEOUT_MS)
    proc.stdout.on('data', d => { out += d })
    proc.stderr.on('data', d => { err += d })
    proc.on('error', e => { clearTimeout(timer); reject(new Error(`Could not run yt-dlp (${e.message})`)) })
    proc.on('close', () => {
      clearTimeout(timer)
      try { resolve(JSON.parse(out.trim().split('\n').pop())) } catch {
        const line = String(err).split('\n').reverse().find(l => /ERROR:/.test(l))
        reject(new Error(line ? line.replace(/^.*?ERROR:\s*/, '').slice(0, 200) : 'SoundCloud did not answer.'))
      }
    })
  })
}

/** The biggest square cover (t500x500) from yt-dlp's thumbnail list. */
function coverOf(entry) {
  const thumbs = Array.isArray(entry.thumbnails) ? entry.thumbnails : []
  const pick = thumbs.find(t => t.id === 't500x500') || thumbs.find(t => t.id === 't300x300') || thumbs[thumbs.length - 1]
  return pick?.url || entry.thumbnail || null
}

/** One search entry as an online result. */
function mapEntry(entry) {
  const id = idFromUrl(entry.url) || (TRACK_ID.test(String(entry.id || '')) ? String(entry.id) : null)
  if (!id) return null
  const duration = Number(entry.duration) || null
  return {
    provider: 'sc',
    id,
    title: entry.title || 'Unknown Track',
    artist: entry.artist || entry.uploader || '',
    artists: [entry.artist || entry.uploader].filter(Boolean),
    album: null,
    duration,
    thumbnail: coverOf(entry),
    kind: 'song',
    // Go+ tracks only offer a 30-second preview to everyone else.
    preview: duration != null && Math.round(duration) === 30,
    url: trackUrl(id),
  }
}

/** Tracks on SoundCloud for `query` (cached ten minutes). */
async function searchTracks(query, { ytdlp, limit = 10 } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return []
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const key = q.toLowerCase()
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.at < SEARCH_TTL_MS) return cached.results.slice(0, limit)
  const json = await runJson(ytdlp, ['--flat-playlist', '-J', '--no-warnings', `scsearch${Math.max(1, Math.min(limit, 30))}:${q}`])
  const results = (json?.entries || []).map(mapEntry).filter(Boolean)
  if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value)
  searchCache.set(key, { at: Date.now(), results })
  return results.slice(0, limit)
}

/** Where joined HLS tracks are kept (the playback cache, under its size limit). */
function hlsDir() {
  let dir = null
  try { dir = require('../cache').cacheDir('playback') } catch {}
  return dir || path.join(os.tmpdir(), 'lokal-playback-cache')
}

const MIME_OF_EXT = { m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/ogg' }
const safeName = text => String(text || '').replace(/[^\w.-]+/g, '_')

/** A track already joined earlier: { file, mime, preview }, or null. */
function joinedFile(id) {
  const dir = hlsDir()
  let name
  try { name = fs.readdirSync(dir).find(n => n.startsWith(`sc-${id}-`) && !n.endsWith('.part')) } catch { return null }
  if (!name) return null
  const file = path.join(dir, name)
  try { const now = new Date(); fs.utimesSync(file, now, now) } catch {}
  return { file, mime: MIME_OF_EXT[path.extname(name).slice(1).toLowerCase()] || 'audio/*', preview: /preview/i.test(name) }
}

async function fetchChecked(url, headers, fetchImpl, as) {
  const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(HLS_PIECE_TIMEOUT_MS) })
  if (!res.ok) {
    try { await res.body?.cancel?.() } catch {}
    throw new Error(`SoundCloud refused a piece of the track (HTTP ${res.status}).`)
  }
  return as === 'text' ? res.text() : Buffer.from(await res.arrayBuffer())
}

/** The pieces of an HLS playlist: the init section (fragmented MP4) and the media, as full URLs. */
function hlsPieces(playlist, base) {
  const lines = String(playlist || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('#EXTM3U')) throw new Error('SoundCloud sent no playlist for this track.')
  if (lines.some(l => l.startsWith('#EXT-X-STREAM-INF'))) throw new Error('Unexpected SoundCloud playlist.')
  const key = lines.find(l => l.startsWith('#EXT-X-KEY'))
  if (key && !/METHOD=NONE/i.test(key)) throw new Error('This SoundCloud track is encrypted and can’t be played.')
  const map = lines.find(l => l.startsWith('#EXT-X-MAP'))?.match(/URI="([^"]+)"/)?.[1]
  const media = lines.filter(l => !l.startsWith('#'))
  if (!media.length) throw new Error('SoundCloud sent an empty playlist for this track.')
  const full = u => new URL(u, base).href
  return { init: map ? full(map) : null, media: media.map(full) }
}

/** Fetches every piece (a few at a time) and joins them into `file`. */
async function joinHls(playlistUrl, file, { headers = {}, fetchImpl = globalThis.fetch } = {}) {
  const { init, media } = hlsPieces(await fetchChecked(playlistUrl, headers, fetchImpl, 'text'), playlistUrl)
  const urls = init ? [init, ...media] : media
  const parts = new Array(urls.length)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const i = next++
      let lastError
      for (let tries = 0; tries < 3 && parts[i] == null; tries++) {
        try { parts[i] = await fetchChecked(urls[i], headers, fetchImpl) } catch (e) { lastError = e }
      }
      if (parts[i] == null) throw lastError
    }
  }
  await Promise.all(Array.from({ length: Math.min(HLS_PARALLEL, urls.length) }, worker))
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const part = `${file}.${process.pid}.part`
  await fsp.writeFile(part, Buffer.concat(parts))
  await fsp.rename(part, file).catch(async (e) => { await fsp.unlink(part).catch(() => {}); if (!fs.existsSync(file)) throw e })
  return file
}

/**
 * The audio of a track: the progressive MP3's URL (seekable, cached a while),
 * or, for an HLS-only track, a file of its joined pieces ({ type: 'file' }).
 */
async function resolveStream(id, { ytdlp, force = false, fetchImpl = globalThis.fetch } = {}) {
  if (!TRACK_ID.test(String(id || ''))) throw new Error('Not a SoundCloud track id')
  const cached = streamCache.get(id)
  if (!force && cached && cached.expiresAt > Date.now() && (!cached.file || fs.existsSync(cached.file))) return cached
  if (resolving.has(id)) return resolving.get(id)
  const joined = joinedFile(id)
  if (joined) return { type: 'file', headers: {}, expiresAt: Date.now() + STREAM_TTL_MS, ...joined }
  if (!ytdlp) throw new Error('yt-dlp is not installed. Install it from the Download page.')
  const job = runJson(ytdlp, ['-j', '--no-warnings', '--no-playlist', '-f', FORMAT, trackUrl(id)])
    .then(async info => {
      if (!info?.url) throw new Error('SoundCloud has no playable stream for this track.')
      const preview = /preview/i.test(String(info.format_id || ''))
      const ext = String(info.ext || '').toLowerCase()
      const mime = MIME_OF_EXT[ext] || 'audio/*'
      let stream
      if (/m3u8/i.test(String(info.protocol || ''))) {
        const file = path.join(hlsDir(), `sc-${id}-${safeName(info.format_id || 'hls')}.${MIME_OF_EXT[ext] ? ext : 'm4a'}`)
        await joinHls(info.url, file, { headers: info.http_headers || {}, fetchImpl })
        stream = { type: 'file', file, headers: {}, mime, expiresAt: Date.now() + STREAM_TTL_MS, preview }
      } else {
        stream = { url: info.url, headers: info.http_headers || {}, mime, expiresAt: Date.now() + STREAM_TTL_MS, preview }
      }
      if (streamCache.size > 200) streamCache.delete(streamCache.keys().next().value)
      streamCache.set(id, stream)
      return stream
    })
    .finally(() => resolving.delete(id))
  resolving.set(id, job)
  return job
}

module.exports = { searchTracks, resolveStream, mapEntry, idFromUrl, trackUrl, hlsPieces, joinHls }
