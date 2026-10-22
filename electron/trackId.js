// A song's own id, kept in the MP3 itself (TXXX:LOKAL_ID), so a playlist
// (electron/playlistFiles.js) still finds the song after it's moved to another
// folder, renamed or retagged. Lokal for Android makes and writes the same id
// (app/src/main/java/com/lokal/music/data/TrackId.kt):
//
//   LOKAL_ID = first 16 hex of SHA-1("lokal|<LOKAL_ADDED in seconds>|<SHA-1 hex of the audio sample>")
//
// The audio sample is the first 64 KB after the ID3v2 tag: tag edits, the
// file's name and folder don't change it, and it tells apart songs added in
// the same second (same LOKAL_ADDED). Nothing depends on the device or the
// clock, so both apps make the same id for a file and write it the same way
// (electron/replayGainTag.js writeLokalId, a port of Android's Id3Writer):
// the same file stamped on both before Syncthing syncs comes out the same to
// the byte. The id is made once; later changes to the file never change it.
//
// Every scan (and every new file) stamps the MP3s that have no id yet, after
// their LOKAL_ADDED (electron/addedDate.js); tracks.lokal_id is its copy in the
// library.

const fs = require('fs')
const crypto = require('crypto')
const tags = require('./replayGainTag')
const addedDate = require('./addedDate')

const TAG = 'LOKAL_ID'
const SAMPLE_BYTES = 64 * 1024
const ID_PATTERN = /^[0-9a-f]{16}$/

const sha1 = data => crypto.createHash('sha1').update(data).digest('hex')

/** The id from the date added (seconds since 1970) and the audio sample. */
function computeId(addedSeconds, sample) {
  return sha1(`lokal|${Math.floor(Number(addedSeconds))}|${sha1(sample)}`).slice(0, 16)
}

/** The first 64 KB after the ID3v2 tag (less in a shorter file). */
function audioSample(filePath, audioStart, size) {
  const length = Math.max(0, Math.min(SAMPLE_BYTES, size - audioStart))
  const buffer = Buffer.alloc(length)
  const fd = fs.openSync(filePath, 'r')
  try { fs.readSync(fd, buffer, 0, length, audioStart) } finally { fs.closeSync(fd) }
  return buffer
}

/** The id in a music-metadata result, or null. */
function fromMeta(meta) {
  for (const tag of Object.values(meta?.native || {}).flat()) {
    if (!tag || (tag.id !== `TXXX:${TAG}` && String(tag.id).toUpperCase() !== TAG)) continue
    const values = Array.isArray(tag.value) ? tag.value : [tag.value]
    for (const value of values) {
      const text = String(typeof value === 'string' ? value : value?.text || '').trim()
      if (text) return text
    }
  }
  return null
}

/**
 * The file's id: the one in it, or made and written now (needs LOKAL_ADDED in
 * the file). Null when it has neither date nor id, isn't an MP3 or can't be
 * written.
 */
function stampFile(filePath) {
  if (!/\.mp3$/i.test(filePath)) return null
  const read = tags.readLokalTags(filePath)
  if (!read) return null
  if (read.id) return read.id
  const added = addedDate.parse(read.added)
  if (added == null) return null
  const id = computeId(added, audioSample(filePath, read.audioStart, read.size))
  tags.writeLokalId(filePath, id)
  return id
}

function ensureColumn(db) {
  try { db.prepare('ALTER TABLE tracks ADD COLUMN lokal_id TEXT').run() } catch {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_tracks_lokal_id ON tracks(lokal_id)').run() } catch {}
}

/**
 * Library songs without an id get theirs: read from the file when it has one
 * (written on the other device), else made and written. `filePaths`: only
 * those files (a new file); all songs without one otherwise.
 * -> { read, written, failed }
 */
async function stampTrackIds(db, filePaths = null) {
  ensureColumn(db)
  const rows = filePaths
    ? filePaths.map(file => db.prepare('SELECT id, file_path FROM tracks WHERE file_path = ? AND lokal_id IS NULL').get(file)).filter(Boolean)
    : db.prepare("SELECT id, file_path FROM tracks WHERE lokal_id IS NULL AND file_path NOT LIKE 'ghost://%'").all()
  const update = db.prepare('UPDATE tracks SET lokal_id = ?, last_modified = ? WHERE id = ?')
  const result = { read: 0, written: 0, failed: 0 }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!/\.mp3$/i.test(row.file_path)) continue
    try {
      const before = tags.readLokalTags(row.file_path)?.id
      const id = stampFile(row.file_path)
      if (!id) continue
      // The file's new time, so the next scan doesn't read it again for this.
      update.run(id, fs.statSync(row.file_path).mtimeMs, row.id)
      if (before) result.read++
      else result.written++
    } catch {
      result.failed++
    }
    // A big library: let the app breathe between files.
    if (i % 25 === 24) await new Promise(resolve => setImmediate(resolve))
  }
  return result
}

module.exports = { TAG, ID_PATTERN, computeId, audioSample, fromMeta, stampFile, ensureColumn, stampTrackIds }
