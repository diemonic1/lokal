// Listening history kept as files in the music folder, so Lokal for PC and
// Lokal for Android (and any number of either) share it through Syncthing
// without a single conflict:
//
//   <music folder>/ListeningHistory/
//     PC_<id>/         one folder per device; only that device writes in it
//       device.json    { type, id, name, created }
//       2026-10.jsonl  the plays that ended in that month (UTC), one JSON per line
//     Android_<id>/
//       ...
//
// <id> is made once per install from the time it was made (a hash, so two
// devices never share one) and kept with the app's data: wiping the data
// makes a new id and a new folder. A line is only ever appended:
//
//   {"end":1792615071,"sec":187,"dur":203,"path":"Artist/Album/01 Song.mp3",
//    "title":"…","artist":"…","album":"…","albumArtist":"…","genre":"…",
//    "id":"t-…", "user":"u-…"}
//
//   end   when listening stopped (seconds since 1970, UTC)
//   sec   seconds actually listened (pauses and seeks don't count)
//   dur   the song's length in seconds
//   path  the file relative to the music folder ('/' separated); absent for
//         songs streamed from search (they have only "id")
//   id    Lokal for PC's track id; user: the PC account (absent for 'guest')
//   the tags are there for a song whose file is gone or renamed since.
//
// Listening to an online radio station is a line of its own, one per time a
// station was listened to (from tuning in to switching away), without songs:
//
//   {"end":1792615071,"sec":2410,"station":"s-…","stationName":"Radio X","stationUrl":"https://…"}
//
// (the station's id, title and stream from the catalogue; stations are told
// apart by their title, as the id goes with the place in the catalogue).
//
// play_history in the database is a copy of every device's files (rebuilt
// whenever one of them changes), so recaps, Flow, mixes and the rest read it
// as before; radio_history is the stations' share. Plays made while the music folder can't be reached wait in the
// app's data (history-pending.jsonl) and move into the folder later.

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { getDB, getStorageDir } = require('./ipc/db')

const FOLDER = 'ListeningHistory'
const DEVICE_TYPE = 'PC'
const DEVICE_DIR = /^(PC|Android)_[0-9A-Za-z]+$/
const MONTH_FILE = /^\d{4}-\d{2}\.jsonl$/
const QUALIFIED_SECONDS = 30
const SESSION_GAP_SECONDS = 30 * 60
const POLL_MS = 30 * 1000
// The plays recorded before this system came in are dropped once (they were only in this PC's database).
const SCHEMA_VERSION = '1'

let started = false
let pollTimer = null
let deviceCache = null
// file -> "size:mtime" of the history files as last read into the database.
let readSignatures = null

function readSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '' } catch { return '' }
}

function musicRoot(db = getDB()) {
  const root = readSetting(db, 'music_folder')
  if (!root) return null
  try { return fs.statSync(root).isDirectory() ? root : null } catch { return null }
}

/** This install's id and name, made on first use and kept in the app's data folder. */
function device() {
  if (deviceCache) return deviceCache
  const file = path.join(getStorageDir(), 'history-device.json')
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof saved?.id === 'string' && /^[0-9a-f]{16}$/.test(saved.id)) {
      deviceCache = { id: saved.id, created: saved.created || null }
      return deviceCache
    }
  } catch {}
  const created = new Date().toISOString()
  // The current time down to the nanosecond: two devices can't make the same one.
  const id = crypto.createHash('sha256').update(`${created}|${process.hrtime.bigint()}|${process.pid}`).digest('hex').slice(0, 16)
  deviceCache = { id, created }
  try { fs.writeFileSync(file, JSON.stringify(deviceCache)) } catch (e) { console.warn('[history] device id not saved:', e.message) }
  return deviceCache
}

const deviceFolderName = () => `${DEVICE_TYPE}_${device().id}`
const deviceName = () => { try { return os.hostname() || 'PC' } catch { return 'PC' } }
const pendingFile = () => path.join(getStorageDir(), 'history-pending.jsonl')

/** "2026-10.jsonl": the month (UTC) a play ended in. */
function monthFileName(endSeconds) {
  const date = new Date(endSeconds * 1000)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}.jsonl`
}

/** This device's folder, with its device.json (made if missing). */
function ownFolder(root) {
  const dir = path.join(root, FOLDER, deviceFolderName())
  fs.mkdirSync(dir, { recursive: true })
  const info = path.join(dir, 'device.json')
  if (!fs.existsSync(info)) {
    fs.writeFileSync(info, JSON.stringify({ type: DEVICE_TYPE, id: device().id, name: deviceName(), created: device().created }, null, 2))
  }
  return dir
}

function signatureOf(file) {
  try { const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}` } catch { return '' }
}

/** Appends whole lines to this device's month files (each line goes to the month it ended in). */
function appendLines(root, lines) {
  const dir = ownFolder(root)
  const byFile = new Map()
  for (const line of lines) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    const name = monthFileName(Number(entry.end) || Math.floor(Date.now() / 1000))
    if (!byFile.has(name)) byFile.set(name, [])
    byFile.get(name).push(line)
  }
  for (const [name, list] of byFile) {
    const file = path.join(dir, name)
    fs.appendFileSync(file, list.map(line => line + '\n').join(''))
    // Our own write isn't news: no rebuild for it.
    if (readSignatures) readSignatures.set(file, signatureOf(file))
  }
}

/** Plays that waited for the music folder go into it. */
function flushPending(root) {
  const file = pendingFile()
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch { return }
  const lines = text.split('\n').filter(line => line.trim())
  if (lines.length) appendLines(root, lines)
  fs.rmSync(file, { force: true })
}

/** Every device's month files: [{ file, folder }]. */
function historyFiles(root) {
  const base = path.join(root, FOLDER)
  let folders
  try { folders = fs.readdirSync(base, { withFileTypes: true }) } catch { return [] }
  const out = []
  for (const entry of folders) {
    if (!entry.isDirectory() || !DEVICE_DIR.test(entry.name)) continue
    let names
    try { names = fs.readdirSync(path.join(base, entry.name)) } catch { continue }
    for (const name of names) {
      // Syncthing's conflict copies ("2026-10.sync-conflict-….jsonl") don't match: only one device writes a file.
      if (MONTH_FILE.test(name)) out.push({ file: path.join(base, entry.name, name), folder: entry.name })
    }
  }
  return out
}

function readDeviceLabel(root, folder) {
  const type = folder.split('_')[0]
  try {
    const info = JSON.parse(fs.readFileSync(path.join(root, FOLDER, folder, 'device.json'), 'utf8'))
    if (info?.name) return `${type} · ${info.name}`
  } catch {}
  return type
}

function parseLines(text, into, extra) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry
    // A line still being written (or cut off) is skipped; the rest are read.
    try { entry = JSON.parse(line) } catch { continue }
    if (!entry || !Number.isFinite(Number(entry.end))) continue
    into.push({ ...entry, ...extra })
  }
}

const relKey = (rel) => String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
const songKey = (artist, title) => `${String(artist || '').trim().toLowerCase()}\u0000${String(title || '').trim().toLowerCase()}`

/** A file's path relative to the music folder, '/' separated; null outside it or for streamed songs. */
function relativePath(root, filePath) {
  if (!root || !filePath || String(filePath).startsWith('ghost://')) return null
  const rel = path.relative(root, filePath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

/** Plays at or past the PC's scrobble threshold count towards a song's play count. */
function playCountRule(db) {
  const threshold = parseInt(readSetting(db, 'scrobble_threshold'), 10)
  const percent = Number.isFinite(threshold) ? threshold : 30
  return (seconds, duration) => seconds >= Math.max(QUALIFIED_SECONDS, (Number(duration) || 0) * (percent / 100))
}

/** Every device's plays, read again into play_history (and the songs' play counts). */
function rebuild(db, root, files) {
  const entries = []
  for (const { file, folder } of files) {
    let text
    try { text = fs.readFileSync(file, 'utf8') } catch { continue }
    parseLines(text, entries, { _folder: folder })
  }
  try { parseLines(fs.readFileSync(pendingFile(), 'utf8'), entries, { _folder: deviceFolderName() }) } catch {}

  const labels = new Map()
  const labelOf = (folder) => {
    if (!labels.has(folder)) labels.set(folder, root ? readDeviceLabel(root, folder) : `${DEVICE_TYPE} · ${deviceName()}`)
    return labels.get(folder)
  }

  const tracks = db.prepare('SELECT id, file_path, artist, title, duration FROM tracks').all()
  const byId = new Map()
  const byPath = new Map()
  const bySong = new Map()
  for (const track of tracks) {
    byId.set(track.id, track)
    const rel = relativePath(root, track.file_path)
    if (rel) byPath.set(relKey(rel), track)
    const key = songKey(track.artist, track.title)
    // A file of the song wins over a streamed copy of it.
    if (!bySong.has(key) || (bySong.get(key).file_path.startsWith('ghost://') && !track.file_path.startsWith('ghost://'))) bySong.set(key, track)
  }
  // The same file first, then the same track id (streamed songs), then the same artist and title (moved or renamed).
  const match = (entry) => (entry.path && byPath.get(relKey(entry.path))) || (entry.id && byId.get(entry.id)) || bySong.get(songKey(entry.artist, entry.title)) || null

  entries.sort((a, b) => Number(a.end) - Number(b.end))
  const seen = new Set()
  const rows = []
  const radioRows = []
  const lastByUser = new Map()
  for (const entry of entries) {
    const end = Math.floor(Number(entry.end))
    const seconds = Math.max(0, Math.round(Number(entry.sec) || 0))
    // A play moved from the pending file twice (a crash in between) counts once.
    const key = `${entry._folder}|${end}|${seconds}|${entry.stationName || entry.path || entry.id || songKey(entry.artist, entry.title)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (entry.stationName) {
      const user = typeof entry.user === 'string' && entry.user ? entry.user : 'guest'
      radioRows.push([user, entry.station ? String(entry.station) : null, String(entry.stationName), entry.stationUrl ? String(entry.stationUrl) : null, seconds, end, labelOf(entry._folder)])
      continue
    }
    const track = match(entry)
    if (!track) continue
    const user = typeof entry.user === 'string' && entry.user ? entry.user : 'guest'
    // Sessions: plays with less than 30 minutes between them, across devices.
    const last = lastByUser.get(user)
    const session = last && end - seconds - last.end <= SESSION_GAP_SECONDS ? last.session : `ls-${user}-${end}`
    lastByUser.set(user, { end, session })
    rows.push([user, track.id, seconds, session, end, labelOf(entry._folder)])
  }

  const counts = new Map()
  const qualifies = playCountRule(db)
  for (const [, trackId, seconds] of rows) {
    if (qualifies(seconds, byId.get(trackId)?.duration)) counts.set(trackId, (counts.get(trackId) || 0) + 1)
  }

  db.transaction(() => {
    db.prepare('DELETE FROM play_history').run()
    const insert = db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, session_id, played_at, device) VALUES (?, ?, ?, ?, ?, ?)')
    for (const row of rows) insert.run(...row)
    db.prepare('DELETE FROM radio_history').run()
    const insertRadio = db.prepare('INSERT INTO radio_history (user_id, station_id, station_name, station_url, seconds_played, played_at, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    for (const row of radioRows) insertRadio.run(...row)
    // Only the counts that changed are written (an update re-indexes the song for search).
    const update = db.prepare('UPDATE tracks SET play_count = ? WHERE id = ?')
    const current = new Map(db.prepare('SELECT id, play_count FROM tracks WHERE play_count != 0').all().map(row => [row.id, Number(row.play_count)]))
    for (const id of current.keys()) {
      if (!counts.has(id)) update.run(0, id)
    }
    for (const [id, count] of counts) {
      if (current.get(id) !== count) update.run(count, id)
    }
  })()
  return rows.length + radioRows.length
}

function ensureSchema(db) {
  for (const sql of [
    'ALTER TABLE play_history ADD COLUMN seconds_played INTEGER DEFAULT 0',
    'ALTER TABLE play_history ADD COLUMN session_id TEXT',
    'ALTER TABLE play_history ADD COLUMN device TEXT',
  ]) { try { db.exec(sql) } catch {} }
  // Online radio: time spent on each station (no songs).
  db.exec(`
    CREATE TABLE IF NOT EXISTS radio_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      station_id TEXT,
      station_name TEXT NOT NULL,
      station_url TEXT,
      seconds_played INTEGER DEFAULT 0,
      played_at INTEGER NOT NULL,
      device TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rh_user_time ON radio_history(user_id, played_at);
  `)
  if (readSetting(db, 'history_files_version') === SCHEMA_VERSION) return
  // The start of the shared history: what only this PC's database knew is dropped.
  db.transaction(() => {
    db.prepare('DELETE FROM play_history').run()
    try { db.prepare('DELETE FROM listening_events').run() } catch {}
    db.prepare('UPDATE tracks SET play_count = 0 WHERE play_count != 0').run()
    db.prepare("DELETE FROM user_settings WHERE key = 'listening_preferences'").run()
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('history_files_version', ?)").run(SCHEMA_VERSION)
  })()
}

function notifyChanged() {
  try {
    const { BrowserWindow } = require('electron')
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('history:changed')
  } catch {}
}

/**
 * Reads the history files into the database when any of them changed since
 * (another device's plays came in through Syncthing, the music folder moved),
 * or always with `force` (the library was scanned: new songs can match plays).
 */
function sync({ force = false } = {}) {
  const db = getDB()
  if (!db) return
  try {
    ensureSchema(db)
    const root = musicRoot(db)
    if (root) {
      try { flushPending(root) } catch (e) { console.warn('[history] pending plays not moved:', e.message) }
    }
    const files = root ? historyFiles(root) : []
    const signatures = new Map(files.map(({ file }) => [file, signatureOf(file)]))
    const pending = signatureOf(pendingFile())
    if (pending) signatures.set(pendingFile(), pending)
    const same = readSignatures && readSignatures.size === signatures.size && [...signatures].every(([file, sig]) => readSignatures.get(file) === sig)
    if (same && !force) return
    rebuild(db, root, files)
    readSignatures = signatures
    notifyChanged()
  } catch (e) {
    console.warn('[history] sync failed:', e.message)
  }
}

/** One line into this device's file, or the pending file while the music folder can't be written. */
function writeEntry(root, entry) {
  const line = JSON.stringify(entry)
  try {
    if (!root) throw new Error('no music folder')
    flushPending(root)
    appendLines(root, [line])
  } catch {
    try { fs.appendFileSync(pendingFile(), line + '\n') } catch (e) { console.warn('[history] play not saved:', e.message) }
    if (readSignatures) readSignatures.set(pendingFile(), signatureOf(pendingFile()))
  }
}

/** Listening to an online radio station that just ended after `seconds`: station = { id, title, url }. */
function recordStation(payload = {}) {
  const db = getDB()
  const station = payload.station || {}
  const name = String(station.title || '').trim()
  const seconds = Math.max(0, Math.round(Number(payload.seconds) || 0))
  if (!db || !name) return null
  ensureSchema(db)
  const userId = payload.userId || 'guest'
  const end = Math.floor(Date.now() / 1000)
  const entry = { end, sec: seconds }
  if (station.id) entry.station = String(station.id)
  entry.stationName = name
  if (station.url) entry.stationUrl = String(station.url)
  if (userId !== 'guest') entry.user = userId
  writeEntry(musicRoot(db), entry)
  db.prepare('INSERT INTO radio_history (user_id, station_id, station_name, station_url, seconds_played, played_at, device) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, entry.station || null, name, entry.stationUrl || null, seconds, end, `${DEVICE_TYPE} · ${deviceName()}`)
  return true
}

/**
 * A play of `trackId` that just ended after `seconds` of listening: written to
 * this device's file (or the pending file) and into play_history at once.
 */
function recordPlay(payload = {}) {
  const db = getDB()
  const trackId = payload.trackId
  const seconds = Math.max(0, Math.round(Number(payload.seconds) || 0))
  if (!db || !trackId) return null
  ensureSchema(db)
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  const userId = payload.userId || 'guest'
  const end = Math.floor(Date.now() / 1000)
  const root = musicRoot(db)
  const entry = { end, sec: seconds }
  if (track.duration) entry.dur = Math.round(Number(track.duration))
  const rel = relativePath(root, track.file_path)
  if (rel) entry.path = rel
  entry.id = track.id
  for (const [key, value] of [['title', track.title], ['artist', track.artist], ['album', track.album], ['albumArtist', track.album_artist], ['genre', track.genres || track.genre]]) {
    if (value) entry[key] = String(value)
  }
  if (userId !== 'guest') entry.user = userId
  writeEntry(root, entry)

  const last = db.prepare('SELECT session_id, played_at FROM play_history WHERE user_id = ? ORDER BY played_at DESC LIMIT 1').get(userId)
  const session = last?.session_id && end - seconds - Number(last.played_at || 0) <= SESSION_GAP_SECONDS ? last.session_id : `ls-${userId}-${end}`
  db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, session_id, played_at, device) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, track.id, seconds, session, end, `${DEVICE_TYPE} · ${deviceName()}`)
  if (playCountRule(db)(seconds, track.duration)) db.prepare('UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = ?').run(track.id)
  return session
}

/** Reads the files once now and then every half a minute (Syncthing brings other devices' plays at any time). */
function start() {
  if (started) return
  started = true
  sync({ force: true })
  pollTimer = setInterval(() => sync(), POLL_MS)
  pollTimer.unref?.()
}

function stop() {
  clearInterval(pollTimer)
  pollTimer = null
  started = false
}

/**
 * The History page's rows, newest first: songs (the track's own row with
 * played_at, seconds_played, device) and online radio stations ({ kind:
 * 'station', station: { id, title, url }, … }), `limit` of them ended before `before`.
 */
function historyPage(db, userId = 'guest', limit = 30, before = null) {
  ensureSchema(db)
  const until = Number(before) || 9e15
  const count = Math.max(1, Math.min(2000, Number(limit) || 30))
  const songs = db.prepare(`SELECT t.*, ph.id AS history_id, ph.played_at, COALESCE(ph.seconds_played, 0) AS seconds_played, ph.device FROM tracks t JOIN play_history ph ON ph.track_id = t.id WHERE ph.user_id = ? AND ph.played_at < ? ORDER BY ph.played_at DESC, ph.id DESC LIMIT ?`).all(userId, until, count)
  const stations = db.prepare('SELECT * FROM radio_history WHERE user_id = ? AND played_at < ? ORDER BY played_at DESC, id DESC LIMIT ?').all(userId, until, count)
    .map(row => ({ kind: 'station', history_id: `r${row.id}`, played_at: row.played_at, seconds_played: row.seconds_played, device: row.device, station: { id: row.station_id, title: row.station_name, url: row.station_url } }))
  return [...songs, ...stations].sort((a, b) => b.played_at - a.played_at).slice(0, count)
}

/** Where the history is kept, for Settings: { folder, device }. */
function info() {
  const root = musicRoot()
  return { folder: root ? path.join(root, FOLDER) : null, device: deviceFolderName(), name: deviceName() }
}

module.exports = { start, stop, sync, recordPlay, recordStation, historyPage, info, relativePath, monthFileName, FOLDER }
