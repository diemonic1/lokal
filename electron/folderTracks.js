// A library folder's songs as an ordered list, kept in their track-number
// tags (the folder is read newest first: the biggest number on top).
//
//   setTrackNumbers   Library > "Reorder": the new numbers go into the tags
//   moveTrackToFolder a song dragged onto another folder in the sidebar
//   addFilesToFolder  files dropped from the computer onto an open folder
//   placeDownload     a downloaded song, into Settings > Library > Downloads >
//                     Download Folder (download_folder)
//
// A song moved or added gets the folder's biggest number plus one (a folder's
// numbers needn't start at 1), so it lands at the top of the folder.

const fs = require('fs-extra')
const path = require('path')
const { folderFilter } = require('./libraryFolder')

const AUDIO_EXTS = new Set(['.mp3', '.flac', '.m4a', '.ogg', '.wav', '.aac', '.opus', '.wma', '.alac', '.ape'])

const { aimpSafeSylt } = require('./syltEncoding')
let taglib = null
function lib() {
  if (taglib === null) {
    try { taglib = require('node-taglib-sharp') } catch { taglib = false }
  }
  return taglib || null
}

function musicRoot(db) {
  return db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value || ''
}

/** The folder's absolute path, or null when it isn't inside the music folder. */
function folderPath(db, relativeFolder) {
  const root = musicRoot(db)
  if (!root || typeof relativeFolder !== 'string' || !relativeFolder) return null
  const rootPath = path.resolve(root)
  const target = path.resolve(rootPath, relativeFolder)
  const rel = path.relative(rootPath, target)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return target
}

/** The biggest track number among the folder's songs (0 when none has one). */
function maxTrackNumber(db, relativeFolder, exceptId = null) {
  const filter = folderFilter(db, relativeFolder)
  if (!filter) return 0
  const row = db.prepare(`SELECT MAX(track_num) AS n FROM tracks WHERE ${filter.sql} AND file_path NOT LIKE 'ghost://%'${exceptId ? ' AND id <> ?' : ''}`)
    .get(...filter.params, ...(exceptId ? [exceptId] : []))
  return Number(row?.n) || 0
}

/** Writes the track number into the file's tags (taglib keeps the rest). */
function writeTrackNumber(filePath, number) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    file.tag.track = Math.max(0, Math.floor(Number(number) || 0))
    // taglib adds an ID3v1 tag to MP3s that never had one; don't.
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    aimpSafeSylt(T, file)
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

function saveNumber(db, track, number) {
  writeTrackNumber(track.file_path, number)
  let mtime = null
  try { mtime = fs.statSync(track.file_path).mtimeMs } catch {}
  db.prepare('UPDATE tracks SET track_num = ?, last_modified = COALESCE(?, last_modified) WHERE id = ?').run(number, mtime, track.id)
}

/** [{ id, track_num }] -> { ok, saved, failed: [{ id, error }] } */
function setTrackNumbers(db, list) {
  const failed = []
  let saved = 0
  for (const item of Array.isArray(list) ? list : []) {
    const track = db.prepare('SELECT id, file_path, track_num FROM tracks WHERE id = ?').get(item?.id)
    const number = Math.floor(Number(item?.track_num))
    if (!track || String(track.file_path).startsWith('ghost://') || !(number >= 0)) { failed.push({ id: item?.id, error: 'Not a song in the library' }); continue }
    if (Number(track.track_num) === number) continue
    try { saveNumber(db, track, number); saved++ } catch (e) { failed.push({ id: track.id, error: e.message }) }
  }
  return { ok: !failed.length, saved, failed }
}

/** "name.mp3" -> "name (2).mp3" while one is already there. */
function freeName(dir, base) {
  const ext = path.extname(base)
  const stem = path.basename(base, ext)
  let candidate = path.join(dir, base)
  for (let i = 2; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`)
  return candidate
}

// Lyrics and other files that sit next to a song under its name go with it.
const SIDECARS = ['.lrc', '.elrc', '.ttml', '.json', '.txt']

/** Moves the song's file into the folder; its number becomes the folder's biggest + 1. */
const BUSY = /EBUSY|EPERM|EACCES/i

/**
 * Moves a file, failing at once when it can't be: Node's own rename, not
 * fs-extra's, whose graceful-fs keeps retrying a locked file on Windows for
 * up to a minute (the "Move to folder" dialog hung meanwhile). Across drives
 * it's a copy, then the original goes; if that can't, the copy goes instead.
 */
async function moveFile(from, to, deadline = Infinity) {
  const native = require('node:fs').promises
  try {
    await native.rename(from, to)
  } catch (e) {
    if (e?.code !== 'EXDEV') throw e
    await native.copyFile(from, to, require('node:fs').constants.COPYFILE_EXCL)
    // Past the time the app waits (the dialog has given up): undone.
    if (Date.now() > deadline) {
      await native.unlink(to).catch(() => {})
      throw Object.assign(new Error('Moving took too long'), { code: 'ETIMEDOUT' })
    }
    try { await native.unlink(from) } catch (error) { await native.unlink(to).catch(() => {}); throw error }
  }
}

// Why a file couldn't be moved, as a phrase the app translates (the system's
// own message, untranslated, goes along as `detail` for the rest).
const MOVE_ERRORS = {
  EBUSY: 'The file is busy: it is playing or another program is using it',
  EPERM: 'No permission to move the file: it is read-only or another program is using it',
  EACCES: 'No permission to move the file: it is read-only or another program is using it',
  ENOSPC: 'There is not enough free space on the disk',
  ENOENT: 'The file is no longer on disk',
  EEXIST: 'A file with that name is already in that folder',
  ENAMETOOLONG: 'The file name is too long for that folder',
  EROFS: 'The disk is read-only',
  ETIMEDOUT: 'It took longer than 5 seconds: the file is probably held by another program',
}
function moveError(e) {
  const code = String(e?.code || (String(e?.message || '').match(/\b(E[A-Z]{3,})\b/) || [])[1] || '')
  const known = MOVE_ERRORS[code]
  return known ? { error: known, busy: BUSY.test(code) } : { error: 'Unexpected error', detail: String(e?.message || e).slice(0, 200), busy: false }
}

function checkMove(db, trackId, relativeFolder) {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  if (!track || String(track.file_path).startsWith('ghost://')) return { error: 'It is not a song from the music folder' }
  const dir = folderPath(db, relativeFolder)
  if (!dir) return { error: 'That folder is not in the music folder' }
  if (!fs.existsSync(track.file_path)) return { error: 'The file is no longer on disk' }
  if (path.resolve(path.dirname(track.file_path)).toLowerCase() === dir.toLowerCase()) return { error: 'The song is already in that folder', same: true }
  return { track, dir }
}

/** What "Move to folder?" shows: the song's title and artist from its tags, and its new number. */
async function previewMove(db, trackId, relativeFolder) {
  const checked = checkMove(db, trackId, relativeFolder)
  if (checked.error) return { ok: false, error: checked.error, same: !!checked.same }
  const { track } = checked
  let title = ''
  let artist = ''
  try {
    const meta = await require('./musicMetadata').parseFile(track.file_path, { duration: false, skipCovers: true })
    title = String(meta.common.title || '').trim()
    artist = String(meta.common.artist || '').trim()
  } catch {}
  return { ok: true, title, artist, fileName: path.basename(track.file_path), trackNum: maxTrackNumber(db, relativeFolder, track.id) + 1 }
}

/**
 * Moves the song's file into the folder; its number becomes the folder's
 * biggest + 1. The file is moved first: one the player still has open can't
 * be (Windows), and then nothing has changed ({ busy: true }).
 */
async function moveTrackToFolder(db, trackId, relativeFolder) {
  const checked = checkMove(db, trackId, relativeFolder)
  if (checked.error) return { ok: false, error: checked.error, same: !!checked.same }
  const { track, dir } = checked
  await fs.ensureDir(dir)
  const target = freeName(dir, path.basename(track.file_path))
  const number = maxTrackNumber(db, relativeFolder, track.id) + 1
  try {
    // A little under the dialog's 5 seconds, so it never reports a failure
    // for a move that then completes.
    await moveFile(track.file_path, target, Date.now() + 4500)
  } catch (e) {
    // A move across drives copies first: a copy left behind goes.
    if (fs.existsSync(track.file_path) && fs.existsSync(target)) await fs.remove(target).catch(() => {})
    console.warn(`[folderTracks] couldn't move ${track.file_path}: ${e?.code || ''} ${e?.message || e}`)
    return { ok: false, ...moveError(e) }
  }
  try {
    writeTrackNumber(target, number)
  } catch (e) {
    // The number couldn't be written: the file goes back where it was.
    await moveFile(target, track.file_path).catch(() => {})
    console.warn(`[folderTracks] couldn't number ${target}: ${e?.message || e}`)
    return { ok: false, error: "The new track number couldn't be written into the file", detail: String(e?.message || e).slice(0, 200) }
  }
  const oldStem = path.join(path.dirname(track.file_path), path.basename(track.file_path, path.extname(track.file_path)))
  const newStem = path.join(dir, path.basename(target, path.extname(target)))
  for (const ext of SIDECARS) {
    if (fs.existsSync(oldStem + ext) && !fs.existsSync(newStem + ext)) { try { await moveFile(oldStem + ext, newStem + ext) } catch {} }
  }
  let mtime = null
  try { mtime = fs.statSync(target).mtimeMs } catch {}
  db.prepare('UPDATE tracks SET file_path = ?, track_num = ?, last_modified = COALESCE(?, last_modified) WHERE id = ?').run(target, number, mtime, track.id)
  try { db.prepare('UPDATE lyrics_cache SET file_path = ? WHERE file_path = ?').run(target, track.file_path) } catch {}
  return { ok: true, filePath: target, trackNum: number, track: db.prepare('SELECT * FROM tracks WHERE id = ?').get(track.id) }
}

/** A file name made of tag text: no characters Windows refuses, not too long. */
function safeFileStem(text) {
  const clean = String(text || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  return clean.slice(0, 180).trim()
}

/** "Artist - Title.ext" when the tags hold both, else the file's own name. */
async function droppedFileName(source) {
  try {
    const meta = await require('./musicMetadata').parseFile(source, { duration: false, skipCovers: true })
    const artist = safeFileStem(meta.common.artist)
    const title = safeFileStem(meta.common.title)
    if (artist && title) return `${artist} - ${title}${path.extname(source).toLowerCase()}`
  } catch {}
  return path.basename(source)
}

/**
 * A downloaded file renamed "Artist - Title.ext" from its tags, like a dropped
 * file (droppedFileName), in its own folder; its lyrics files go with it.
 * -> the new path (the old one when the tags lack either or it can't be renamed).
 */
async function renameToTags(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return filePath
  const dir = path.dirname(filePath)
  const base = await droppedFileName(filePath)
  if (base === path.basename(filePath)) return filePath
  // Only the case differs: the same file on Windows, renamed in place.
  const sameName = base.toLowerCase() === path.basename(filePath).toLowerCase()
  const target = sameName ? path.join(dir, base) : freeName(dir, base)
  try { await moveFile(filePath, target) } catch (e) {
    console.warn(`[folderTracks] couldn't rename ${filePath}: ${e?.code || ''} ${e?.message || e}`)
    return filePath
  }
  const oldStem = filePath.slice(0, -path.extname(filePath).length)
  const newStem = target.slice(0, -path.extname(target).length)
  for (const ext of SIDECARS) {
    if (fs.existsSync(oldStem + ext) && (sameName || !fs.existsSync(newStem + ext))) { try { await moveFile(oldStem + ext, newStem + ext) } catch {} }
  }
  return target
}

/**
 * A new song's tags on an open taglib file: the comment it came with isn't
 * this library's (see fileComment.js), and "Music" isn't a genre (YouTube and
 * stores put it there); its other genres stay. -> whether anything changed.
 */
function cleanOpenNewSong(T, file, filePath) {
  const { splitGenres, genreKey } = require('./genreList')
  let changed = false
  const genres = Array.isArray(file.tag.genres) ? file.tag.genres : []
  const parts = splitGenres(genres.join(';'))
  const kept = parts.filter(name => genreKey(name) !== 'music')
  if (kept.length !== parts.length) { file.tag.genres = kept; changed = true }
  if (String(file.tag.comment || '').trim()) {
    require('./fileComment').setOpenFileComment(T, file, filePath, '')
    changed = true
  }
  return changed
}

/** The same for a file on disk (a download), saved only when something changed. */
function cleanNewSongTags(filePath) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    if (!cleanOpenNewSong(T, file, filePath)) return false
    if (/\.mp3$/i.test(filePath) && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    aimpSafeSylt(T, file)
    file.save()
    return true
  } finally {
    try { file?.dispose() } catch {}
  }
}

/**
 * A dropped file's copy: its track number, no "Music" genre and no comment
 * (cleanOpenNewSong). One save.
 */
function prepareDroppedCopy(filePath, number) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    file.tag.track = Math.max(0, Math.floor(Number(number) || 0))
    cleanOpenNewSong(T, file, filePath)
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    aimpSafeSylt(T, file)
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

/**
 * Copies files into the folder, numbered on from its biggest number. A copy
 * is named "Artist - Title" when its tags hold both, loses a "Music" genre
 * and its comment.
 */
async function addFilesToFolder(db, filePaths, relativeFolder) {
  const dir = folderPath(db, relativeFolder)
  if (!dir) return { ok: false, error: 'That folder is not in the music folder', added: [], failed: [] }
  await fs.ensureDir(dir)
  let next = maxTrackNumber(db, relativeFolder) + 1
  const added = []
  const failed = []
  for (const source of Array.isArray(filePaths) ? filePaths : []) {
    try {
      if (typeof source !== 'string' || !fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('File not found')
      if (!AUDIO_EXTS.has(path.extname(source).toLowerCase())) throw new Error('Not an audio file')
      const target = freeName(dir, await droppedFileName(source))
      await fs.copy(source, target)
      try { prepareDroppedCopy(target, next) } catch (e) { await fs.remove(target).catch(() => {}); throw e }
      // It joins the library now (LOKAL_ADDED, see addedDate.js).
      require('./addedDate').stampNewFile(db, target)
      // And its own id (LOKAL_ID, trackId.js) and loudness (ReplayGain,
      // loudness.js) go into it at once, not when it's first scanned or played.
      try { require('./trackId').stampFile(target) } catch (e) { console.warn(`[addFilesToFolder] Song id skipped for ${target}:`, e.message) }
      if (/\.mp3$/i.test(target)) {
        await require('./loudness').measureIntoFile({ db, file: target })
          .catch(e => console.warn(`[addFilesToFolder] Loudness skipped for ${target}:`, e.message))
      }
      added.push({ filePath: target, trackNum: next })
      next++
    } catch (e) { failed.push({ filePath: source, error: e.message }) }
  }
  return { ok: !failed.length, added, failed }
}

/**
 * What "Add files to the folder?" shows: each file's title and artist from
 * its tags, and the number it will get there (in the order given).
 */
async function previewFilesForFolder(db, filePaths, relativeFolder) {
  const mm = require('./musicMetadata')
  let next = maxTrackNumber(db, relativeFolder) + 1
  const out = []
  for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
    const audio = typeof filePath === 'string' && AUDIO_EXTS.has(path.extname(filePath).toLowerCase())
    let title = ''
    let artist = ''
    if (audio) {
      try {
        const meta = await mm.parseFile(filePath, { duration: false, skipCovers: true })
        title = String(meta.common.title || '').trim()
        artist = String(meta.common.artist || '').trim()
      } catch {}
    }
    out.push({ filePath, title, artist, trackNum: audio ? next++ : null, audio })
  }
  return out
}

// The last number given to a download per folder: songs of a playlist are
// added to the library only at its end, so the database doesn't know them yet.
const downloadNumbers = new Map()

/**
 * A finished download, moved into the library folder chosen for downloads
 * (`relativeFolder`, inside the music folder) and numbered on from its
 * biggest number, like a file dropped onto it. -> the file's new path (the
 * old one when it can't be moved). The tag is left as it was if it can't be
 * written.
 */
function placeDownload(db, filePath, relativeFolder) {
  const dir = folderPath(db, relativeFolder)
  if (!dir || !filePath || !fs.existsSync(filePath)) return filePath
  let target = filePath
  if (path.resolve(path.dirname(filePath)).toLowerCase() !== path.resolve(dir).toLowerCase()) {
    try {
      fs.ensureDirSync(dir)
      target = freeName(dir, path.basename(filePath))
      fs.moveSync(filePath, target)
    } catch { return filePath }
    // Its lyrics file, if one was saved next to it.
    const oldBase = filePath.slice(0, -path.extname(filePath).length)
    const newBase = target.slice(0, -path.extname(target).length)
    for (const ext of SIDECARS) {
      try { if (fs.existsSync(oldBase + ext) && !fs.existsSync(newBase + ext)) fs.moveSync(oldBase + ext, newBase + ext) } catch {}
    }
  }
  const key = path.resolve(dir).toLowerCase()
  const next = Math.max(maxTrackNumber(db, relativeFolder), downloadNumbers.get(key) || 0) + 1
  try { writeTrackNumber(target, next); downloadNumbers.set(key, next) } catch {}
  return target
}

module.exports = { placeDownload, cleanNewSongTags, renameToTags, maxTrackNumber, writeTrackNumber, setTrackNumbers, moveTrackToFolder, previewMove, addFilesToFolder, previewFilesForFolder, folderPath }
