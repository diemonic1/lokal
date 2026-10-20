// The full-size cover of a library song, read out of its file on demand (the
// covers cache only keeps a small thumbnail, see thumb.js): for the
// fullscreen player and a cover opened big. Once read, it's kept in the
// covers cache next to the thumbnail (`<base>.full.<ext>`) and the song's row
// points at it, so the whole library shows it full size from then on. A song
// whose full cover was never opened keeps its thumbnail.

const fs = require('fs')
const path = require('path')

function pictureMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length > 6 && /^GIF8/.test(bytes.toString('latin1', 0, 4))) return 'image/gif'
  return 'image/jpeg'
}

const FULL_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
/** A full-size cover kept in the covers cache (never shrunk back, see shrinkCovers.js). */
const FULL_NAME = /\.full\.(?:jpg|png|webp|gif)$/i
const isKeptFull = artworkPath => FULL_NAME.test(String(artworkPath || ''))

/** The full-size cover kept for the thumbnail `<base>.*` in `dir`, or null. */
function keptFullFor(dir, base) {
  for (const ext of Object.values(FULL_EXT)) {
    const file = path.join(dir, `${base}.full.${ext}`)
    if (fs.existsSync(file)) return file
  }
  return null
}

const isLocalFile = filePath => !!filePath && !/^(ghost|https?|radio):/i.test(String(filePath)) && fs.existsSync(filePath)

/** The picture inside an audio file (front cover first), or null. */
async function filePicture(filePath) {
  if (!isLocalFile(filePath)) return null
  try {
    const bytes = require('../trackCover').readFileCover(filePath)
    if (bytes?.length) return bytes
  } catch {}
  // Formats the tag reader doesn't know: music-metadata, which the scan uses.
  try {
    const mm = require('../musicMetadata')
    const meta = await mm.parseFile(filePath, { duration: false, skipCovers: false })
    const pictures = meta.common.picture || []
    const pic = pictures.find(p => /front/i.test(String(p.type || ''))) || pictures[0]
    if (pic?.data?.length) return Buffer.from(pic.data)
  } catch {}
  return null
}

/**
 * The full cover of a song row, or null when there's nothing bigger than what
 * the library already shows: an online song, a cover from the music folder
 * (cover.jpg -- shown as it is), or a file without a picture.
 * -> { bytes, mime } | null
 */
async function fullCoverFor(track, storageDir) {
  if (!track || !isLocalFile(track.file_path)) return null
  const art = track.artwork_path ? path.resolve(String(track.artwork_path)) : null
  if (art && storageDir && path.dirname(art).toLowerCase() !== path.resolve(storageDir, 'artwork').toLowerCase()) return null
  // Kept before: read from the cache rather than out of the song's file.
  if (art && isKeptFull(art)) {
    try {
      const kept = fs.readFileSync(art)
      if (kept.length) return { bytes: kept, mime: pictureMime(kept) }
    } catch {}
  }
  const bytes = await filePicture(track.file_path)
  if (!bytes) return null
  return { bytes, mime: pictureMime(bytes) }
}

/**
 * Keeps a full cover just read in the covers cache, next to the song's
 * thumbnail, and points the song (every row using that thumbnail) at it.
 * -> the path the rows have now, or null when nothing changed.
 */
function keepFullCover(db, track, cover) {
  const art = track?.artwork_path ? String(track.artwork_path) : ''
  // Only a thumbnail is smaller than the picture (without sharp the cache has it as it is).
  if (!art || isKeptFull(art) || !/\.webp$/i.test(art) || !cover?.bytes?.length) return null
  const ext = FULL_EXT[cover.mime]
  if (!ext) return null
  const full = path.join(path.dirname(art), `${path.basename(art).replace(/\.[^.]+$/, '')}.full.${ext}`)
  try { if (!fs.existsSync(full)) fs.writeFileSync(full, cover.bytes) } catch { return null }
  try { db.prepare('UPDATE tracks SET artwork_path = ? WHERE artwork_path = ?').run(full, art) } catch { return null }
  return full
}

module.exports = { fullCoverFor, filePicture, pictureMime, keepFullCover, keptFullFor, isKeptFull }
