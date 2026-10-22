// Playlists kept as M3U8 files in the music folder, so Lokal for PC and Lokal
// for Android share them through Syncthing (Lokal for Android's
// data/Playlists.kt reads and writes the same files the same way):
//
//   <music folder>/Playlists/
//     Road trip.m3u8      one file per playlist, named after it
//     Любимые.m3u8        the favourites (Liked Songs): made with the first like, never while
//                         they're off (made only then, so two devices don't each make one)
//
// A file, UTF-8 without BOM, '\n' line ends:
//
//   #EXTM3U
//   #PLAYLIST:Road trip                  the name (renaming renames the file too)
//   #LOKAL-ID:pl-…                       made once, never changes: the same
//                                        playlist on every device, whatever its file is called
//   #LOKAL-KIND:favorites                only in the favourites
//   #LOKAL-COVER:data:image/jpeg;base64,…   the picture, inside the file
//   #LOKAL-TRACK:7f3a9c2e1b04d8aa         the song's own id (TXXX:LOKAL_ID, electron/trackId.js)
//   #EXTINF:203,Artist - Title
//   ../Artist/Album/01 Song.mp3          relative to the playlist file, '/' separated
//
// A line's song is found by its id first (so moving the MP3 to another folder,
// renaming or retagging it keeps it in the playlist), then by its path, then
// by "Artist - Title". Whenever a playlist is written, the lines of songs it
// finds get their current id and path. The order of the lines is the
// playlist's order. A line whose song isn't in the library (not synced yet)
// is kept as it is when the file is written again. Every change is written at once; Syncthing's conflict copies
// are not read.
//
// The database's playlists / playlist_tracks (rows with file_name) and
// user_likes are a copy of the files, rebuilt whenever one of them changes, so
// the rest of the app (smart playlists, mixes, Flow, hearts) reads them as
// before. Smart playlists stay in the database only.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { getDB, getStorageDir } = require('./ipc/db')

const FOLDER = 'Playlists'
const FAVORITES_FILE = 'Любимые.m3u8'
const FAVORITES_NAME = 'Любимые'
const FAVORITES_KIND = 'favorites'
const POLL_MS = 10 * 1000
const COVER_SIZE = 600
// liked_at for the favourites' first song; each next one a second older, so
// "ORDER BY liked_at DESC" is the file's order.
const LIKED_TOP = 2000000000
const isWindows = process.platform === 'win32'

let pollTimer = null
let readSignatures = null
let favoritesId = null

function readSetting(db, key) {
  try { return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? '' } catch { return '' }
}

function writeSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value))
}

function musicRoot(db = getDB()) {
  const root = readSetting(db, 'music_folder')
  if (!root) return null
  try { return fs.statSync(root).isDirectory() ? root : null } catch { return null }
}

/** Settings → Playlists. */
function favoritesEnabled(db = getDB()) { return readSetting(db, 'playlists_favorites') !== '0' }
function addToEnd(db = getDB()) { return readSetting(db, 'playlists_add_position') === 'end' }

function folderOf(root) { return path.join(root, FOLDER) }

// ------------------------------------------------------------------ format

function newId() { return `pl-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}` }

/** { name, id, kind, cover, extra, entries: [{ path, duration, label }] } of a file's text. */
function parse(text) {
  const out = { name: '', id: '', kind: '', cover: null, extra: [], entries: [] }
  let info = null
  let trackId = null
  for (const raw of String(text || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) {
      const colon = line.indexOf(':')
      const tag = (colon > 0 ? line.slice(0, colon) : line).toUpperCase()
      const value = colon > 0 ? line.slice(colon + 1).trim() : ''
      if (tag === '#EXTM3U') continue
      if (tag === '#PLAYLIST') out.name = value
      else if (tag === '#LOKAL-ID') out.id = value
      else if (tag === '#LOKAL-KIND') out.kind = value.toLowerCase()
      else if (tag === '#LOKAL-COVER') out.cover = value || null
      else if (tag === '#LOKAL-TRACK') trackId = value || null
      else if (tag === '#EXTINF') {
        const match = value.match(/^(-?\d+(?:\.\d+)?)[^,]*,(.*)$/)
        info = match ? { duration: Math.round(Number(match[1])), label: match[2].trim() } : null
      } else if (!out.entries.length) out.extra.push(line)
      continue
    }
    out.entries.push({ path: line, duration: info?.duration ?? null, label: info?.label || '', trackId })
    info = null
    trackId = null
  }
  return out
}

function oneLine(value) { return String(value || '').replace(/[\r\n]+/g, ' ').trim() }

function serialize(playlist) {
  const lines = ['#EXTM3U', `#PLAYLIST:${oneLine(playlist.name)}`, `#LOKAL-ID:${playlist.id}`]
  if (playlist.kind) lines.push(`#LOKAL-KIND:${playlist.kind}`)
  if (playlist.cover) lines.push(`#LOKAL-COVER:${playlist.cover}`)
  lines.push(...(playlist.extra || []))
  for (const entry of playlist.entries) {
    if (entry.trackId) lines.push(`#LOKAL-TRACK:${oneLine(entry.trackId)}`)
    if (entry.duration != null || entry.label) lines.push(`#EXTINF:${entry.duration ?? -1},${oneLine(entry.label)}`)
    lines.push(entry.path)
  }
  return lines.join('\n') + '\n'
}

/** A song's line: its path relative to the Playlists folder ('/' separated), absolute on another drive. */
function entryPath(folder, filePath) {
  const rel = path.relative(folder, filePath)
  if (!rel || path.isAbsolute(rel)) return filePath.replace(/\\/g, '/')
  return rel.replace(/\\/g, '/')
}

function resolveEntry(folder, line) {
  if (/^[a-zA-Z]:[\\/]/.test(line) || line.startsWith('/') || line.startsWith('\\\\')) return path.normalize(line)
  return path.resolve(folder, line)
}

function pathKey(filePath) {
  const key = path.normalize(String(filePath || '')).normalize('NFC')
  return isWindows ? key.toLowerCase() : key
}

function labelOf(track) {
  return track.artist ? `${track.artist} - ${track.title || ''}` : String(track.title || '')
}

function entryOf(folder, track) {
  return { path: entryPath(folder, track.file_path), duration: track.duration ? Math.round(track.duration) : null, label: labelOf(track), trackId: track.lokal_id || null }
}

/** A file name for a playlist called `name` (Windows and Android safe), not taken by another file. */
function fileNameFor(folder, name, current = null) {
  let base = oneLine(name).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Playlist'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`
  for (let n = 1; ; n++) {
    const candidate = `${base}${n > 1 ? ` (${n})` : ''}.m3u8`
    if (current && candidate.toLowerCase() === current.toLowerCase()) return current
    if (candidate.toLowerCase() === FAVORITES_FILE.toLowerCase()) continue
    if (!fs.existsSync(path.join(folder, candidate))) return candidate
  }
}

function isPlaylistFile(name) {
  return /\.m3u8$/i.test(name) && !/\.sync-conflict-/i.test(name) && !name.startsWith('.')
}

function readFile(file) {
  try { return parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** Written whole, through a temporary file, so a half-written playlist is never read or synced. */
function writeFile(file, playlist) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`)
  fs.writeFileSync(temp, serialize(playlist), 'utf8')
  fs.renameSync(temp, file)
}

/** Every playlist file: [{ file, fileName, data }]. Ids are made for files that have none. */
function listFiles(root) {
  const folder = folderOf(root)
  let names = []
  try { names = fs.readdirSync(folder).filter(isPlaylistFile) } catch { return [] }
  const out = []
  const seen = new Set()
  for (const fileName of names) {
    const file = path.join(folder, fileName)
    const data = readFile(file)
    if (!data) continue
    if (!data.name) data.name = fileName.replace(/\.m3u8$/i, '')
    if (fileName.toLowerCase() === FAVORITES_FILE.toLowerCase()) data.kind = FAVORITES_KIND
    // A file made elsewhere (by hand, another player), or copied: it gets an id of its own.
    if (!data.id || seen.has(data.id)) {
      data.id = newId()
      try { writeFile(file, data) } catch {}
    }
    seen.add(data.id)
    out.push({ file, fileName, data })
  }
  return out
}

// ---------------------------------------------------------------- database

function ensureSchema(db) {
  try { db.prepare('ALTER TABLE playlists ADD COLUMN file_name TEXT').run() } catch {}
}

function signatureOf(file) {
  try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}` } catch { return null }
}

function folderSignatures(root) {
  const folder = folderOf(root)
  const out = new Map()
  try {
    for (const name of fs.readdirSync(folder)) if (isPlaylistFile(name)) out.set(name, signatureOf(path.join(folder, name)))
  } catch {}
  return out
}

/** The picture of a playlist as a file in the app's data (the pages show files), or null. */
function coverFile(id, dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i)
  if (!match) return null
  const dir = path.join(getStorageDir(), 'artwork')
  const hash = crypto.createHash('sha1').update(match[2]).digest('hex').slice(0, 10)
  const ext = match[1].toLowerCase() === 'png' ? 'png' : match[1].toLowerCase() === 'webp' ? 'webp' : 'jpg'
  const file = path.join(dir, `playlist-${id.replace(/[^\w-]/g, '_')}-${hash}.${ext}`)
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const prefix = `playlist-${id.replace(/[^\w-]/g, '_')}-`
      for (const old of fs.readdirSync(dir)) if (old.startsWith(prefix)) try { fs.unlinkSync(path.join(dir, old)) } catch {}
      fs.writeFileSync(file, Buffer.from(match[2], 'base64'))
    } catch { return null }
  }
  return file
}

/**
 * (folder, entry) => the library track id of a playlist line, or null: by the
 * song's own id, its path, or "Artist - Title" when only one song is called
 * that. find.row(id): that track's row.
 */
function trackLookup(db) {
  require('./trackId').ensureColumn(db)
  const rows = db.prepare("SELECT id, file_path, title, artist, duration, lokal_id FROM tracks WHERE file_path NOT LIKE 'ghost://%'").all()
  const byId = new Map()
  const byLokalId = new Map()
  const byPath = new Map()
  const byLabel = new Map()
  for (const row of rows) {
    byId.set(row.id, row)
    if (row.lokal_id && !byLokalId.has(row.lokal_id)) byLokalId.set(row.lokal_id, row.id)
    byPath.set(pathKey(row.file_path), row.id)
    const label = labelOf(row).toLowerCase()
    byLabel.set(label, byLabel.has(label) ? null : row.id)
  }
  const find = (folder, entry) => (entry.trackId && byLokalId.get(entry.trackId))
    || byPath.get(pathKey(resolveEntry(folder, entry.path)))
    || (entry.label && byLabel.get(entry.label.toLowerCase()))
    || null
  find.row = id => byId.get(id) || null
  return find
}

/** Playlists made before the files: written out once, then read back like any other. */
function migrate(db, root) {
  if (readSetting(db, 'playlists_files_migrated') === '1') return
  const folder = folderOf(root)
  const old = db.prepare("SELECT * FROM playlists WHERE file_name IS NULL AND (smart_rules IS NULL OR smart_rules = '')").all()
  for (const playlist of old) {
    const tracks = db.prepare(`SELECT t.* FROM tracks t JOIN playlist_tracks pt ON pt.track_id = t.id WHERE pt.playlist_id = ? AND t.file_path NOT LIKE 'ghost://%' ORDER BY pt.position`).all(playlist.id)
    let cover = null
    try { if (playlist.cover_path) cover = `data:image/jpeg;base64,${fs.readFileSync(playlist.cover_path).toString('base64')}` } catch {}
    const seen = new Set()
    const entries = tracks.filter(track => !seen.has(track.id) && seen.add(track.id)).map(track => entryOf(folder, track))
    writeFile(path.join(folder, fileNameFor(folder, playlist.name)), { name: playlist.name, id: newId(), cover, entries })
    db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(playlist.id)
    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlist.id)
  }
  // Liked Songs become the favourites file (newest first, as they showed).
  const favorites = path.join(folder, FAVORITES_FILE)
  if (favoritesEnabled(db) && !fs.existsSync(favorites)) {
    const liked = db.prepare("SELECT t.* FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE t.file_path NOT LIKE 'ghost://%' ORDER BY ul.liked_at DESC").all()
    const seen = new Set()
    const entries = liked.filter(track => !seen.has(track.id) && seen.add(track.id)).map(track => entryOf(folder, track))
    if (entries.length) writeFile(favorites, { name: FAVORITES_NAME, id: newId(), kind: FAVORITES_KIND, entries })
  }
  writeSetting(db, 'playlists_files_migrated', '1')
}

/** The database's copy of the files, made again. */
function rebuild(db, root) {
  const folder = folderOf(root)
  const files = listFiles(root)
  const find = trackLookup(db)
  const userIds = ['guest', ...db.prepare('SELECT id FROM users').all().map(row => row.id)]
  const keep = new Set()
  const upsert = db.prepare(`INSERT INTO playlists (id, name, user_id, cover_path, file_name) VALUES (?, ?, 'guest', ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, cover_path = excluded.cover_path, file_name = excluded.file_name, smart_rules = NULL`)
  const insertTrack = db.prepare('INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by, added_at) VALUES (?, ?, ?, ?, ?)')
  const insertLike = db.prepare('INSERT OR IGNORE INTO user_likes (user_id, track_id, liked_at) VALUES (?, ?, ?)')
  favoritesId = null
  db.transaction(() => {
    db.prepare('DELETE FROM user_likes').run()
    for (const { fileName, data } of files) {
      if (data.kind === FAVORITES_KIND) {
        if (!favoritesEnabled(db) || favoritesId) continue
        favoritesId = data.id
        data.entries.forEach((entry, index) => {
          const id = find(folder, entry)
          if (id) for (const user of userIds) insertLike.run(user, id, LIKED_TOP - index)
        })
        continue
      }
      keep.add(data.id)
      upsert.run(data.id, data.name, coverFile(data.id, data.cover), fileName)
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(data.id)
      data.entries.forEach((entry, index) => {
        const id = find(folder, entry)
        if (id) insertTrack.run(data.id, id, index, 'guest', null)
      })
    }
    for (const row of db.prepare('SELECT id FROM playlists WHERE file_name IS NOT NULL').all()) {
      if (keep.has(row.id)) continue
      db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(row.id)
      db.prepare('DELETE FROM playlists WHERE id = ?').run(row.id)
    }
  })()
}

function notifyChanged() {
  try {
    const { BrowserWindow } = require('electron')
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('playlists:changed')
  } catch {}
}

/**
 * Reads the files into the database when any of them changed since (another
 * device's change came in through Syncthing, the music folder moved), or
 * always with `force` (a change made here, a library scan).
 */
function sync({ force = false } = {}) {
  const db = getDB()
  if (!db) return
  try {
    ensureSchema(db)
    const root = musicRoot(db)
    if (!root) return
    const signatures = folderSignatures(root)
    const same = readSignatures && readSignatures.size === signatures.size && [...signatures].every(([file, sig]) => readSignatures.get(file) === sig)
    if (same && !force) return
    migrate(db, root)
    rebuild(db, root)
    readSignatures = folderSignatures(root)
    notifyChanged()
  } catch (e) {
    console.warn('[playlists] sync failed:', e.message)
  }
}

function start() {
  sync({ force: true })
  if (!pollTimer) pollTimer = setInterval(() => sync(), POLL_MS)
}

function stop() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

// ----------------------------------------------------------------- changes

function context() {
  const db = getDB()
  const root = musicRoot(db)
  if (!root) throw new Error('Choose a music folder first')
  return { db, root, folder: folderOf(root) }
}

/** The file of playlist `id` ('liked' / the favourites' id: the favourites, made when missing). */
function locate(root, id) {
  const files = listFiles(root)
  if (id === 'liked' || (favoritesId && id === favoritesId)) {
    const found = files.find(item => item.data.kind === FAVORITES_KIND)
    if (found) return found
    const file = path.join(folderOf(root), FAVORITES_FILE)
    return { file, fileName: FAVORITES_FILE, data: { name: FAVORITES_NAME, id: newId(), kind: FAVORITES_KIND, cover: null, extra: [], entries: [] } }
  }
  return files.find(item => item.data.id === id) || null
}

function change(id, edit) {
  const { db, root, folder } = context()
  if ((id === 'liked' || id === favoritesId) && !favoritesEnabled(db)) throw new Error('Favourites are turned off')
  const found = locate(root, id)
  if (!found) throw new Error('Playlist not found')
  const result = edit(found.data, { db, folder, found }) || {}
  // The songs it finds get their current id and path (moved, or stamped with an id since).
  const find = trackLookup(db)
  found.data.entries = found.data.entries.map(entry => {
    const row = find.row(find(folder, entry))
    return row ? entryOf(folder, row) : entry
  })
  writeFile(result.file || found.file, found.data)
  if (result.file && result.file !== found.file) try { fs.unlinkSync(found.file) } catch {}
  sync({ force: true })
  return { ok: true, id: found.data.id, ...result }
}

function libraryRows(db, trackIds) {
  const { libraryTrackId } = require('./online/sources')
  const rows = []
  const seen = new Set()
  for (const raw of trackIds || []) {
    const id = libraryTrackId(db, raw)
    const row = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(id)
    if (row && !seen.has(row.id)) { seen.add(row.id); rows.push(row) }
  }
  return rows
}


function create(name, { trackIds = [], cover = null } = {}) {
  const { db, folder } = context()
  const clean = oneLine(name).slice(0, 200) || 'Playlist'
  const playlist = { name: clean, id: newId(), cover, extra: [], entries: libraryRows(db, trackIds).map(track => entryOf(folder, track)) }
  writeFile(path.join(folder, fileNameFor(folder, clean)), playlist)
  sync({ force: true })
  return db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlist.id)
}

/**
 * Songs into a playlist, at its start or end (Settings → Playlists), in the
 * order given; a song already there moves to that place instead.
 */
function addTracks(id, trackIds) {
  return change(id, (data, { db, folder }) => {
    const rows = libraryRows(db, trackIds)
    if (!rows.length) throw new Error('Only songs in your library can go into a playlist')
    const find = trackLookup(db)
    const ids = new Set(rows.map(track => track.id))
    data.entries = data.entries.filter(entry => !ids.has(find(folder, entry)))
    const added = rows.map(track => entryOf(folder, track))
    data.entries = addToEnd(db) ? [...data.entries, ...added] : [...added, ...data.entries]
    return { added: rows.length }
  })
}

function removeTracks(id, trackIds) {
  return change(id, (data, { db, folder }) => {
    const find = trackLookup(db)
    const ids = new Set(trackIds)
    const before = data.entries.length
    data.entries = data.entries.filter(entry => !ids.has(find(folder, entry)))
    return { removed: before - data.entries.length }
  })
}

/** The playlist's songs in this order; lines without a song in the library keep their places. */
function reorder(id, trackIds) {
  return change(id, (data, { db, folder }) => {
    const find = trackLookup(db)
    const slots = []
    const byTrack = new Map()
    data.entries.forEach((entry, index) => {
      const trackId = find(folder, entry)
      if (trackId && !byTrack.has(trackId)) { byTrack.set(trackId, entry); slots.push(index) }
    })
    const ordered = [...new Set(trackIds)].filter(trackId => byTrack.has(trackId)).map(trackId => byTrack.get(trackId))
    for (const [trackId, entry] of byTrack) if (!trackIds.includes(trackId)) ordered.push(entry)
    const entries = [...data.entries]
    slots.forEach((slot, i) => { entries[slot] = ordered[i] })
    data.entries = entries
  })
}

/** Repeated songs out, the first of each staying where it is. */
function deduplicate(id) {
  return change(id, (data, { db, folder }) => {
    const find = trackLookup(db)
    const seen = new Set()
    const before = data.entries.length
    data.entries = data.entries.filter(entry => {
      const key = find(folder, entry) || pathKey(resolveEntry(folder, entry.path))
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { removed: before - data.entries.length, kept: data.entries.length }
  })
}

function rename(id, name) {
  const clean = oneLine(name).slice(0, 200)
  if (!clean) throw new Error('Please enter a playlist name')
  return change(id, (data, { folder, found }) => {
    if (data.kind === FAVORITES_KIND) throw new Error('The favourites keep their name')
    data.name = clean
    return { file: path.join(folder, fileNameFor(folder, clean, found.fileName)) }
  })
}

/** A picture (a data: URL) made into a JPEG of at most COVER_SIZE px, or null to take it away. */
function setCover(id, dataUrl) {
  let cover = null
  if (dataUrl) {
    const { nativeImage } = require('electron')
    let image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) throw new Error('This picture could not be read')
    const { width, height } = image.getSize()
    if (Math.max(width, height) > COVER_SIZE) image = image.resize(width >= height ? { width: COVER_SIZE, quality: 'best' } : { height: COVER_SIZE, quality: 'best' })
    cover = `data:image/jpeg;base64,${image.toJPEG(85).toString('base64')}`
  }
  return change(id, data => { data.cover = cover })
}

function remove(id) {
  const { root } = context()
  const found = locate(root, id)
  if (!found || found.data.kind === FAVORITES_KIND) throw new Error('Playlist not found')
  fs.unlinkSync(found.file)
  sync({ force: true })
  return { ok: true }
}

/** Liked or not, from any heart: the favourites file. Only songs in the library. */
function setFavorite(trackId, liked) {
  const db = getDB()
  const [track] = libraryRows(db, [trackId])
  if (!track || !favoritesEnabled(db)) return { liked: false, trackId }
  if (liked) addTracks('liked', [track.id])
  else removeTracks('liked', [track.id])
  return { liked: !!liked, trackId: track.id }
}

function isFavorite(trackId) {
  return !!getDB().prepare('SELECT 1 FROM user_likes WHERE track_id = ? LIMIT 1').get(trackId)
}

/** Settings → Playlists changed: the favourites come or go. */
function settingsChanged() { sync({ force: true }) }

function favoritesPlaylistId() { return favoritesId }

module.exports = {
  FOLDER, FAVORITES_FILE, parse, serialize, entryPath, resolveEntry,
  start, stop, sync, create, addTracks, removeTracks, reorder, deduplicate, rename, setCover, remove,
  setFavorite, isFavorite, favoritesEnabled, settingsChanged, favoritesPlaylistId,
}
