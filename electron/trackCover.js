// A song's cover, replaced by hand (the track menu, Edit Track, a picture
// dropped on the player bar's cover, Batch Edit): the picture goes into the
// audio file's own tags (ID3 APIC, FLAC/Ogg picture, MP4 covr...), so any
// player and the next rescan see it, and into the covers cache the library
// shows. Only JPEG and PNG are written into files; anything else is turned
// into a JPEG first.

const fs = require('fs')
const path = require('path')

const { aimpSafeSylt } = require('./syltEncoding')
let taglib = null
function lib() {
  if (taglib === null) {
    try { taglib = require('node-taglib-sharp') } catch { taglib = false }
    if (taglib) { try { taglib.Id3v2Settings.useNumericGenres = false } catch {} }
  }
  return taglib || null
}

let sharpLib = null
function sharp() {
  if (sharpLib === null) {
    try { sharpLib = require('sharp') } catch { sharpLib = false }
  }
  return sharpLib || null
}

function imageMime(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length > 8 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  return null
}

/** The picture's bytes from a data: URL (or bytes), as JPEG or PNG. */
async function coverImage(input) {
  let bytes = Buffer.isBuffer(input) ? input : null
  if (!bytes) {
    const text = String(input || '')
    const comma = text.indexOf(',')
    bytes = Buffer.from(comma >= 0 ? text.slice(comma + 1) : text, 'base64')
  }
  if (!bytes.length) throw new Error('No image data')
  let mime = imageMime(bytes)
  if (!mime) {
    const s = sharp()
    if (!s) throw new Error('Only JPEG and PNG pictures can be used as a cover')
    bytes = await s(bytes).jpeg({ quality: 92 }).toBuffer()
    mime = 'image/jpeg'
  }
  return { bytes, mime }
}

const isLocalFile = filePath => !!filePath && !/^(ghost|https?):/i.test(String(filePath)) && fs.existsSync(filePath)

/** Writes the picture as the file's only cover (the front one). */
function writeFileCover(filePath, bytes, mime) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    // An MP3 without tags gets an ID3v2 one (file.tag alone has nowhere to write).
    if (mp3) file.getTag(T.TagTypes.Id3v2, true)
    // FLAC keeps pictures in its own blocks, Ogg in its comments: make sure there's one to write to.
    if (/\.(ogg|oga|opus)$/i.test(filePath)) { try { file.getTag(T.TagTypes.Xiph, true) } catch {} }
    const cover = T.Picture.fromData(T.ByteVector.fromByteArray(bytes))
    cover.type = T.PictureType.FrontCover
    cover.mimeType = mime
    cover.description = 'Cover'
    file.tag.pictures = [cover]
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
 * Sets a song's cover: into its file when it has one on this computer, then
 * the covers cache. Returns the cover's new path (a new name each time, so the
 * pages don't keep showing the old picture from the same address) and whether
 * the file got it.
 */
async function setTrackCover(db, track, imageData, storageDir) {
  const { bytes, mime } = await coverImage(imageData)
  let embedded = false
  if (isLocalFile(track.file_path)) {
    writeFileCover(track.file_path, bytes, mime)
    embedded = true
    require('./fileStamp').noteFileWritten(db, track.file_path)
  }
  const dir = path.join(storageDir, 'artwork')
  fs.mkdirSync(dir, { recursive: true })
  // <id>.jpg is what a rescan reads the cover back into (it keeps one that's there).
  fs.writeFileSync(path.join(dir, `${track.id}.jpg`), bytes)
  const artPath = path.join(dir, `${track.id}-v${Date.now()}.jpg`)
  fs.writeFileSync(artPath, bytes)
  // Older versions go, but not the one just replaced: a page still showing
  // the song (a list, an open Edit Track) keeps its picture until it reads
  // the song again.
  const previous = track.artwork_path ? path.basename(String(track.artwork_path)).toLowerCase() : null
  const version = new RegExp(`^${String(track.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-v\\d+\\.jpg$`, 'i')
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!version.test(name) || name === path.basename(artPath) || name.toLowerCase() === previous) continue
      try { fs.unlinkSync(path.join(dir, name)) } catch {}
    }
  } catch {}
  db.prepare('UPDATE tracks SET artwork_path = ? WHERE id = ?').run(artPath, track.id)
  return { artPath, embedded }
}

/** The cover inside the song's file (its front one, else the first), or null. */
function readFileCover(filePath) {
  const T = lib()
  if (!T || !isLocalFile(filePath)) return null
  let file
  try {
    file = T.File.createFromPath(filePath)
    const pictures = file.tag?.pictures || []
    const picture = pictures.find(p => p.type === T.PictureType.FrontCover) || pictures[0]
    const bytes = picture?.data?.toByteArray ? Buffer.from(picture.data.toByteArray()) : null
    return bytes?.length ? bytes : null
  } catch { return null } finally {
    try { file?.dispose() } catch {}
  }
}

// What Windows (and the others) can't have in a file name; slashes become commas.
const fileNamePart = text => String(text || '').replace(/[\\/]+/g, ',').replace(/[<>:"|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')

/**
 * Saves a song's cover into `dir` (Downloads) as "Artist - Title - Album Art"
 * (.jpg or .png; any other picture is turned into a JPEG), next to what's
 * there already ("... (2)"). The picture inside the file first (full size),
 * else the library's copy. Returns the new file's path.
 */
async function saveTrackCover(track, dir) {
  let bytes = readFileCover(track?.file_path)
  if (!bytes && track?.artwork_path && fs.existsSync(track.artwork_path)) bytes = fs.readFileSync(track.artwork_path)
  if (!bytes?.length) throw new Error('This song has no cover')
  const { bytes: picture, mime } = await coverImage(bytes)
  const ext = mime === 'image/png' ? '.png' : '.jpg'
  const base = [fileNamePart(track.artist), fileNamePart(track.title)].filter(Boolean).join(' - ') || 'Cover'
  fs.mkdirSync(dir, { recursive: true })
  let target = path.join(dir, `${base} - Album Art${ext}`)
  for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} - Album Art (${n})${ext}`)
  fs.writeFileSync(target, picture)
  return target
}

module.exports = { setTrackCover, coverImage, writeFileCover, readFileCover, saveTrackCover }
