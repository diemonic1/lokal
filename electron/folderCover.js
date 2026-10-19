const path = require('path')
const fs = require('fs-extra')

// A folder's own picture is kept as folder_cover.lokal: the image behind a
// header, its bytes scrambled, so phone galleries syncing the music folder
// don't show it as a photo. A folder_cover.jpg/png put in the folder replaces
// it (encodeFolderCover) and is removed.
const STORED_NAME = 'folder_cover.lokal'
const SOURCE_NAMES = ['folder_cover.jpg', 'folder_cover.jpeg', 'folder_cover.png']
const MAGIC = Buffer.from('LOKALFC1')
const KEY = 0x5a
const TYPES = ['image/jpeg', 'image/png']

function scramble(bytes) {
  const out = Buffer.allocUnsafe(bytes.length)
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ KEY
  return out
}

function encode(image, mime) {
  return Buffer.concat([MAGIC, Buffer.from([Math.max(0, TYPES.indexOf(mime))]), scramble(image)])
}

// { bytes, mime } of a folder_cover.lokal's contents, or null.
function decode(data) {
  if (!Buffer.isBuffer(data) || data.length <= MAGIC.length + 1 || !data.subarray(0, MAGIC.length).equals(MAGIC)) return null
  return { bytes: scramble(data.subarray(MAGIC.length + 1)), mime: TYPES[data[MAGIC.length]] || 'image/jpeg' }
}

function mimeOf(image) {
  return image[0] === 0x89 && image[1] === 0x50 ? 'image/png' : 'image/jpeg'
}

// Turns a folder_cover.jpg/png (names: lowercase name → name on disk) into
// folder_cover.lokal, overwriting the old one, and removes the picture.
// The path of folder_cover.lokal, or null when there is none.
function encodeFolderCover(folderPath, names) {
  const stored = names.has(STORED_NAME) ? path.join(folderPath, names.get(STORED_NAME)) : null
  const source = SOURCE_NAMES.find(name => names.has(name))
  if (!source) return stored
  const sourcePath = path.join(folderPath, names.get(source))
  try {
    const image = fs.readFileSync(sourcePath)
    if (!image.length) return stored
    const target = stored || path.join(folderPath, STORED_NAME)
    const temp = target + '.tmp'
    fs.writeFileSync(temp, encode(image, mimeOf(image)))
    fs.renameSync(temp, target)
    fs.removeSync(sourcePath)
    return target
  } catch {
    // Read-only folder, the picture still being copied…: shown as it is.
    return sourcePath
  }
}

// { bytes, mime } of a folder cover file: folder_cover.lokal or a plain picture.
function readFolderCover(filePath) {
  const data = fs.readFileSync(filePath)
  if (path.basename(filePath).toLowerCase() === STORED_NAME) return decode(data)
  return { bytes: data, mime: mimeOf(data) }
}

function isFolderCoverName(filePath) {
  const name = path.basename(String(filePath || '')).toLowerCase()
  return name === STORED_NAME || SOURCE_NAMES.includes(name)
}

module.exports = { STORED_NAME, SOURCE_NAMES, encode, decode, encodeFolderCover, readFolderCover, isFolderCoverName }
