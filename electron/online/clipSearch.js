// The Clip Search tab: the official music video looked up for every library
// song that has none in its tags yet, kept apart until the user saves it.
//
// The lookup is the Videos tab's own (musicVideoFor in ../ipc/online.js: a
// YouTube search, then the video's sound and picture checked against the
// song). Nothing found here touches a file or the database until Save, and
// then only for the songs ticked. Everything found so far lives in its own
// folder (data/clip-search), written after every song, so a search stopped --
// by the Stop button or by the computer going off -- carries on from the same
// song later:
//   state.json        where the search is, the times it took, what's ticked
//   queue.json        the songs to look at, in order (written once)
//   found/<hash>.json one song's video: { trackId, videoId, url, title, youtubeChannel, duration, thumbnail, check, start, end, zoom }
// start / end are the loop times typed in the report (text, as in Edit
// Track's Music video fields); empty ones aren't written. zoom is how far the
// video is zoomed in, 0-100 % (0, the default, isn't written). The safe cache
// cleanup (Cache Analysis) removes the folder.
//
// "Wrong video" marks are kept in the settings table (so the app export
// carries them) as [{ trackId, title, artist, videoId }]: a marked video is
// never offered for that song again. A song also matches by its title and
// artist, so the marks still work after an import elsewhere.

const fs = require('fs')
const path = require('path')
const { createHash } = require('node:crypto')
const storage = require('../ipc/db')

const DIR_NAME = 'clip-search'
const REJECTED_KEY = 'clip_search_rejected'
// The time left is shown once this many songs have been looked at.
const ETA_MIN_SAMPLES = 10
// Shorter songs have no music video (findMusicVideo skips them too).
const MIN_DURATION_S = 30

// ---------------------------------------------------------------- files

function dir() {
  const root = storage.getStorageDir()
  return root ? path.join(root, DIR_NAME) : null
}

const foundFile = (trackId) => path.join(dir(), 'found', `${createHash('sha1').update(String(trackId)).digest('hex')}.json`)

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Written next to it first and moved over, so a power cut never leaves half a file. */
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const data = JSON.stringify(value)
  try {
    fs.writeFileSync(tmp, data)
    fs.renameSync(tmp, file)
  } catch {
    try { fs.rmSync(tmp, { force: true }) } catch {}
    fs.writeFileSync(file, data)
  }
}

function readState() {
  const root = dir()
  if (!root) return null
  const state = readJson(path.join(root, 'state.json'))
  if (!state || state.v !== 1) return null
  return state
}

const saveState = (state) => writeJson(path.join(dir(), 'state.json'), state)
const readQueue = () => readJson(path.join(dir(), 'queue.json')) || []
const readEntry = (trackId) => readJson(foundFile(trackId))

function clearAll() {
  const root = dir()
  if (root) { try { fs.rmSync(root, { recursive: true, force: true }) } catch {} }
}

// ---------------------------------------------------------------- loop times

/** "75", "1:15", "1:02:03", "0:11.5" -> seconds; '' -> null; NaN when it can't be read (as clipVideo.js's parseClipTime). */
function parseClipTime(text) {
  const value = String(text ?? '').replace(/[^0-9.]+/g, ':').replace(/\.+/g, '.').replace(/^:+|:+$/g, '')
  if (!value) return null
  const parts = value.split(':')
  if (parts.length > 3 || parts.some((part, i) => !(i === parts.length - 1 ? /^(?:\d+\.?\d*|\.\d+)$/ : /^\d+$/).test(part))) return NaN
  return parts.map(Number).reduce((total, n) => total * 60 + n, 0)
}

// ---------------------------------------------------------------- wrong videos

const norm = (value) => String(value || '').trim().toLowerCase()

function readRejected(db) {
  let value = null
  try { value = JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(REJECTED_KEY)?.value || 'null') } catch {}
  return Array.isArray(value) ? value.filter(item => item && item.videoId) : []
}

function writeRejected(db, list) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(REJECTED_KEY, JSON.stringify(list))
}

/** The video ids marked wrong for this library row. */
function rejectedFor(list, row) {
  if (!row) return []
  const key = `${norm(row.title)}|${norm(row.artist)}`
  return [...new Set(list.filter(item => String(item.trackId) === String(row.id) || `${norm(item.title)}|${norm(item.artist)}` === key).map(item => item.videoId))]
}

// ---------------------------------------------------------------- the search

let job = null // { cancelled }
let progress = null

function broadcast(channel, payload) {
  try {
    const { BrowserWindow } = require('electron')
    for (const win of BrowserWindow.getAllWindows()) {
      try { if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload) } catch {}
    }
  } catch {}
}

function progressOf(state, current = null) {
  if (!state) return { status: 'idle' }
  const status = state.status === 'running' && !job ? 'stopped' : state.status
  const done = state.next
  const total = state.total
  const avgMs = state.timedCount ? state.timedMs / state.timedCount : null
  return {
    status,
    done,
    total,
    found: state.found.length,
    avgMs,
    etaMs: avgMs != null && state.timedCount >= ETA_MIN_SAMPLES ? Math.round(avgMs * Math.max(0, total - done)) : null,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null,
    // Time spent actually searching (without the pauses), the current run included.
    runMs: (state.runMs || 0) + (state.runStartedAt && status === 'running' ? Date.now() - state.runStartedAt : 0),
    current,
  }
}

function send(state, current) {
  progress = progressOf(state, current)
  broadcast('clipSearch:progress', progress)
}

const youtubeUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`

/** Looks one song up. The entry to keep, or null. */
async function searchOne(db, trackId, rejected) {
  const row = db.prepare('SELECT id, title, artist, duration, file_path, clip_url FROM tracks WHERE id = ?').get(trackId)
  // Given a video meanwhile (Edit Track): nothing to look for.
  if (!row || String(row.clip_url || '').trim()) return null
  if (!row.file_path || String(row.file_path).startsWith('ghost://')) return null
  const { musicVideoFor } = require('../ipc/online')
  const video = await musicVideoFor(trackId, { exclude: rejectedFor(rejected, row) })
  if (!video || !/^[\w-]{11}$/.test(String(video.videoId || ''))) return null
  return {
    trackId,
    videoId: video.videoId,
    url: youtubeUrl(video.videoId),
    title: video.title || '',
    // Only the channel YouTube itself named (musicVideo.js describe), never
    // the artist: unknown, it isn't shown. (Searches before this kept the
    // artist as `channel`, which is no longer read.)
    youtubeChannel: video.channel || '',
    duration: Number(video.duration) || null,
    thumbnail: video.thumbnail || null,
    check: video.check || null,
    start: '',
    end: '',
    zoom: 0,
    foundAt: Date.now(),
  }
}

/** Puts the time spent into the state and marks it stopped or done. */
function finishRun(state, queueLength) {
  state.runMs = (state.runMs || 0) + (state.runStartedAt ? Date.now() - state.runStartedAt : 0)
  state.runStartedAt = null
  state.status = state.next >= queueLength ? 'done' : 'stopped'
  if (state.status === 'done') state.finishedAt = Date.now()
}

async function run(db, state) {
  const current = { cancelled: false }
  job = current
  state.status = 'running'
  state.runStartedAt = Date.now()
  saveState(state)
  const queue = readQueue()
  const titleOf = db.prepare('SELECT title, artist FROM tracks WHERE id = ?')
  // Read whenever the search (re)starts: marks made while it was stopped count too.
  const rejected = readRejected(db)
  try {
    while (state.next < queue.length && !current.cancelled) {
      const trackId = queue[state.next]
      const names = titleOf.get(trackId)
      send(state, names ? `${names.artist || ''} — ${names.title || ''}` : null)
      const started = Date.now()
      let entry = null
      try { entry = await searchOne(db, trackId, rejected) } catch { entry = null }
      // Stopped while this song was being looked up (stop() already saved
      // where the search is): it's looked up again on Continue.
      if (current.cancelled) return
      if (entry) {
        writeJson(foundFile(trackId), entry)
        if (!state.found.includes(trackId)) state.found.push(trackId)
      }
      state.timedMs += Date.now() - started
      state.timedCount++
      state.next++
      saveState(state)
    }
  } catch {
    // Saving failed (the folder went away): nothing to carry on with.
  }
  // Cancelled meanwhile (the folder is gone, maybe a new search started): nothing to save.
  if (job !== current) return
  job = null
  if (!readState()) return
  finishRun(state, queue.length)
  saveState(state)
  send(state, null)
}

// ---------------------------------------------------------------- the tab's calls

const MISSING_SQL = `file_path NOT LIKE 'ghost://%' AND title IS NOT NULL AND artist IS NOT NULL
  AND duration > ${MIN_DURATION_S} AND TRIM(COALESCE(clip_url, '')) = ''`

/** How many library songs have no music video in their tags (the ones a search looks at). */
function counts(db) {
  try { return { missing: db.prepare(`SELECT COUNT(*) AS n FROM tracks WHERE ${MISSING_SQL}`).get().n || 0 } } catch { return { missing: 0 } }
}

function tracksByIds(db, ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    try {
      for (const row of db.prepare(`SELECT * FROM tracks WHERE id IN (${chunk.map(() => '?').join(',')})`).all(...chunk)) out.set(row.id, row)
    } catch {}
  }
  return out
}

/** True when the report can be opened: the search is done, or stopped with what it found so far. */
const reportable = (state) => !!state && !job && (state.status === 'done' || state.status === 'stopped' || state.status === 'running')

/** The tab's whole state: progress, and once the search is done (or stopped), what it found. */
function get(db) {
  const state = readState()
  const base = { progress: progressOf(state, job ? progress?.current : null), counts: counts(db) }
  if (!reportable(state)) return base
  const rows = tracksByIds(db, state.found)
  const checked = new Set(state.checked || [])
  const items = []
  for (const trackId of state.found) {
    const entry = readEntry(trackId)
    const track = rows.get(trackId)
    if (!entry || !track) continue
    items.push({ ...entry, checked: checked.has(trackId), track })
  }
  return { ...base, items }
}

/** Starts a new search over every song without a music video. */
function start(db) {
  if (job) return { running: true }
  if (!dir()) return { ok: false, error: 'No data folder' }
  const ids = db.prepare(`SELECT id FROM tracks WHERE ${MISSING_SQL}
    ORDER BY artist COLLATE NOCASE, album COLLATE NOCASE, track_num, title COLLATE NOCASE`).all().map(row => row.id)
  if (!ids.length) return { ok: false, error: 'Every track already has a music video' }
  clearAll()
  writeJson(path.join(dir(), 'queue.json'), ids)
  const state = { v: 1, status: 'running', total: ids.length, next: 0, timedMs: 0, timedCount: 0, found: [], checked: [], startedAt: Date.now(), finishedAt: null, runMs: 0, runStartedAt: null }
  saveState(state)
  run(db, state).catch(() => {})
  return { ok: true, progress: progressOf(state) }
}

/** Carries on a stopped search from the song it stopped at. */
function resume(db) {
  if (job) return { running: true }
  const state = readState()
  if (!state || state.status === 'done') return { ok: false }
  run(db, state).catch(() => {})
  return { ok: true, progress: progressOf({ ...state, status: 'running' }) }
}

/**
 * Stops the search at once; what was found so far stays. A lookup under way
 * (a video's sound being compared can take a while) runs out in the
 * background and is thrown away: that song is looked up again on Continue.
 */
function stop() {
  if (!job) return { ok: true }
  job.cancelled = true
  job = null
  const state = readState()
  if (state && state.status === 'running') {
    finishRun(state, readQueue().length)
    saveState(state)
    send(state, null)
  }
  return { ok: true }
}

/** Throws away everything found. The songs are left as they are. */
function cancel() {
  if (job) { job.cancelled = true; job = null }
  clearAll()
  progress = { status: 'idle' }
  broadcast('clipSearch:progress', progress)
  return { ok: true }
}

function setChecked(ids, checked) {
  const state = readState()
  if (!state) return { ok: false }
  const set = new Set(state.checked || [])
  for (const id of Array.isArray(ids) ? ids : []) {
    if (checked && state.found.includes(id)) set.add(id)
    else set.delete(id)
  }
  state.checked = [...set]
  saveState(state)
  return { ok: true, checked: state.checked }
}

/** The zoom as a whole percent, 0-100 (anything else: 0), as clipVideo.js's clipZoomPercent. */
function zoomPercent(value) {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

/** The loop times typed for a song's video (kept as typed; checked on Save) and its zoom (left as it is when not given). */
function setTimes(trackId, start, end, zoom) {
  const entry = readEntry(trackId)
  if (!entry) return { ok: false, error: 'not-found' }
  writeJson(foundFile(trackId), { ...entry, start: String(start ?? ''), end: String(end ?? ''), zoom: zoom === undefined ? zoomPercent(entry.zoom) : zoomPercent(zoom) })
  return { ok: true }
}

/** Takes a song out of the report, its found video thrown away. -> { reset } */
function dropFromReport(state, trackId) {
  try { fs.rmSync(foundFile(trackId), { force: true }) } catch {}
  state.found = state.found.filter(id => id !== trackId)
  state.checked = (state.checked || []).filter(id => id !== trackId)
  // The last one gone from a finished search: it starts over, as after Save.
  const reset = !state.found.length && state.status === 'done'
  if (reset) cancel()
  else saveState(state)
  return { reset }
}

/**
 * The report's "Wrong video": the video is marked wrong for the song (never
 * offered for it again) and the song leaves the report; it's looked up again
 * only by a new search.
 */
function reject(db, trackId) {
  const state = readState()
  const entry = readEntry(trackId)
  if (!reportable(state) || !entry || !state.found.includes(trackId)) return { ok: false, error: 'not-found' }
  const row = db.prepare('SELECT id, title, artist FROM tracks WHERE id = ?').get(trackId)
  const list = readRejected(db)
  if (!list.some(item => String(item.trackId) === String(trackId) && item.videoId === entry.videoId)) {
    list.push({ trackId, title: row?.title || '', artist: row?.artist || '', videoId: entry.videoId, url: entry.url, at: Date.now() })
    writeRejected(db, list)
  }
  return { ok: true, ...dropFromReport(state, trackId) }
}

/**
 * Save: the ticked songs get their video (and the loop times typed and the zoom, if any)
 * written into their tags -- Lokal's LOKAL_TRACK tag, as Edit Track does --
 * and leave the list. A stopped search can be saved from too ("Go to
 * report"): it carries on from where it stopped afterwards.
 */
function save(db) {
  if (job) return { ok: false, error: 'running' }
  const state = readState()
  if (!reportable(state)) return { ok: false }
  const trackExtras = require('../trackExtras')
  const { writeFileTags } = require('../fileComment')
  const { noteFileWritten } = require('../fileStamp')
  const ids = (state.checked || []).filter(id => state.found.includes(id))
  const saved = []
  const failed = []
  for (const trackId of ids) {
    const entry = readEntry(trackId)
    if (!entry) { failed.push({ trackId, error: 'not-found' }); continue }
    try {
      const row = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
      if (!row) { failed.push({ trackId, error: 'not-found' }); continue }
      // Given a video meanwhile (Edit Track): that one stays.
      if (String(row.clip_url || '').trim()) { failed.push({ trackId, error: 'has-clip' }); continue }
      const start = parseClipTime(entry.start)
      const end = parseClipTime(entry.end)
      if (Number.isNaN(start) || Number.isNaN(end) || (start != null && end != null && end <= start)) { failed.push({ trackId, error: 'bad-time' }); continue }
      const zoom = zoomPercent(entry.zoom) || null
      const next = { ...row, clip_url: entry.url, clip_start: start, clip_end: end, clip_zoom: zoom }
      if (row.file_path && !String(row.file_path).startsWith('ghost://') && fs.existsSync(row.file_path)) {
        writeFileTags(row.file_path, { lokal_track: trackExtras.toTag(next) })
        noteFileWritten(db, row.file_path)
      }
      db.prepare('UPDATE tracks SET clip_url = ?, clip_start = ?, clip_end = ?, clip_zoom = ? WHERE id = ?').run(next.clip_url, start, end, zoom, trackId)
      saved.push({ trackId, track: db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId) })
    } catch (e) {
      failed.push({ trackId, error: e?.message || String(e) })
    }
  }
  // Their video lives in their tags now: the lookup's own record of it goes.
  if (saved.length) require('../ipc/online').forgetTaggedMusicVideos(saved.map(s => s.trackId))
  // A bad time stays in the list to be fixed; the rest that failed for good leave it.
  const gone = new Set([...saved.map(s => s.trackId), ...failed.filter(f => f.error === 'has-clip' || f.error === 'not-found').map(f => f.trackId)])
  for (const trackId of gone) { try { fs.rmSync(foundFile(trackId), { force: true }) } catch {} }
  state.found = state.found.filter(id => !gone.has(id))
  state.checked = (state.checked || []).filter(id => !gone.has(id))
  // The last one saved: the search starts over -- unless it's only stopped, with songs still to look at.
  const reset = !state.found.length && state.status === 'done'
  if (reset) cancel()
  else saveState(state)
  return { ok: true, saved, failed, reset }
}

module.exports = { get, start, resume, stop, cancel, setChecked, setTimes, reject, save, parseClipTime, rejectedFor, DIR_NAME, REJECTED_KEY }
