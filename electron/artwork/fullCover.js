// The full-size cover of a library song, read out of its file on demand (the
// covers cache only keeps a small thumbnail, see thumb.js): for the
// fullscreen player and a cover opened big. Nothing is written to disk.

const fs = require('fs')
const path = require('path')

function pictureMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length > 6 && /^GIF8/.test(bytes.toString('latin1', 0, 4))) return 'image/gif'
  return 'image/jpeg'
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
  const bytes = await filePicture(track.file_path)
  if (!bytes) return null
  return { bytes, mime: pictureMime(bytes) }
}

module.exports = { fullCoverFor, filePicture, pictureMime }
