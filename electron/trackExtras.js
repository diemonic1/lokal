// A song's explicit mark, its music video (link, start, end, zoom) and its
// important moment (seconds into the song, marked on the seek bar) live in
// the file itself, in Lokal's own LOKAL_TRACK tag -- the way the word-timed
// lyrics live in LOKAL_LYRICS (see ./lyrics/embedded.js): ID3v2 TXXX, a
// Vorbis field, an iTunes freeform atom. Other players ignore it; a rescan
// (or a fresh library) reads them back from the file.
//
// The tag is JSON: { lokal: 1, explicit?: 1, clip?: { url, start?, end?, zoom? }, highlight?: seconds }.
// A song with none of them has no tag.

const fs = require('fs')

const TAG = 'LOKAL_TRACK'
const FORMAT_VERSION = 1
const FIELDS = ['explicit', 'clip_url', 'clip_start', 'clip_end', 'clip_zoom', 'highlight_time']
const IDS = new Set([`TXXX:${TAG}`, TAG, `----:com.apple.iTunes:${TAG}`])

const num = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))

/** The tag's JSON for a library row (or edited values), null when there's nothing to keep. */
function toTag(track = {}) {
  const data = { lokal: FORMAT_VERSION }
  if (Number(track.explicit) || track.explicit === true) data.explicit = 1
  const url = String(track.clip_url || '').trim()
  if (url) {
    const clip = { url }
    for (const [key, field] of [['start', 'clip_start'], ['end', 'clip_end'], ['zoom', 'clip_zoom']]) {
      const value = num(track[field])
      if (value != null) clip[key] = value
    }
    data.clip = clip
  }
  const highlight = num(track.highlight_time)
  if (highlight != null && highlight >= 0) data.highlight = highlight
  return data.explicit || data.clip || data.highlight != null ? JSON.stringify(data) : null
}

function parse(text) {
  if (!text || typeof text !== 'string' || text[0] !== '{') return null
  try {
    const data = JSON.parse(text)
    return data && data.lokal === FORMAT_VERSION ? data : null
  } catch { return null }
}

const tagText = (value) => (typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '')

/**
 * The tag in a music-metadata result as library columns
 * ({ explicit, clip_url, clip_start, clip_end, clip_zoom, highlight_time }), or null when the
 * file has none.
 */
function fromMeta(meta) {
  const values = Object.values(meta?.native || {}).flat()
    .filter(tag => tag && (IDS.has(tag.id) || String(tag.id).toUpperCase() === TAG))
    .map(tag => tagText(tag.value))
  // ID3v2.3 readers split TXXX text at "/" -- and a link is full of them.
  let data = null
  for (const value of values) if ((data = parse(value))) break
  if (!data && values.length > 1) data = parse(values.join('/'))
  if (!data) return null
  const clip = data.clip && typeof data.clip === 'object' && String(data.clip.url || '').trim() ? data.clip : null
  return {
    explicit: data.explicit ? 1 : 0,
    clip_url: clip ? String(clip.url).trim() : null,
    clip_start: clip ? num(clip.start) : null,
    clip_end: clip ? num(clip.end) : null,
    clip_zoom: clip ? num(clip.zoom) : null,
    highlight_time: num(data.highlight),
  }
}

/** True when an edit touches any of the fields kept in the tag. */
const touches = (data = {}) => FIELDS.some(field => data[field] !== undefined)

/** Writes (or removes) the tag in the file from a library row. Throws when the file can't be saved. */
function writeTrackExtras(filePath, track) {
  let T
  try { T = require('node-taglib-sharp') } catch { throw new Error('Tag writer unavailable') }
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  const { setPrivateField } = require('./lyrics/fileLyrics')
  const { aimpSafeSylt } = require('./syltEncoding')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    setPrivateField(T, file, toTag(track), TAG)
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

/** Puts the tag's values into the library row of a just-read file. */
function applyToRow(db, trackId, extras) {
  if (!extras) return
  db.prepare('UPDATE tracks SET explicit = ?, clip_url = ?, clip_start = ?, clip_end = ?, clip_zoom = ?, highlight_time = ? WHERE id = ?')
    .run(extras.explicit, extras.clip_url, extras.clip_start, extras.clip_end, extras.clip_zoom, extras.highlight_time ?? null, trackId)
}

/**
 * Once per library: songs whose explicit mark or video was set before the tag
 * existed get it written into their file. -> how many files were written.
 */
function backfillTrackExtras(db, { log = console } = {}) {
  const DONE_KEY = 'track_extras_tags_v1'
  if (db.prepare('SELECT 1 FROM settings WHERE key = ?').get(DONE_KEY)) return 0
  const rows = db.prepare(`SELECT * FROM tracks
    WHERE (explicit = 1 OR TRIM(COALESCE(clip_url, '')) <> '') AND file_path NOT LIKE 'ghost://%'`).all()
  const { noteFileWritten } = require('./fileStamp')
  let written = 0
  let failed = 0
  for (const row of rows) {
    if (!fs.existsSync(row.file_path)) continue
    try {
      writeTrackExtras(row.file_path, row)
      noteFileWritten(db, row.file_path)
      written++
    } catch (e) {
      failed++
      log.warn?.(`[trackExtras] couldn't write ${row.file_path}: ${e.message}`)
    }
  }
  // A file that was busy is tried again next time.
  if (!failed) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(DONE_KEY, '1')
  return written
}

module.exports = { TAG, FIELDS, toTag, fromMeta, touches, writeTrackExtras, applyToRow, backfillTrackExtras }
