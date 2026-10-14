// music-metadata, with ID3v1 ignored: tags come from ID3v2 (or the format's own
// tags) only. ID3v1 is Latin-1 and cut to 30 characters, so whatever it held
// would otherwise fill any field ID3v2 leaves empty, garbled.
const mm = require('music-metadata')

// The common fields an ID3v1 tag can set.
const ID3V1_FIELDS = ['title', 'artist', 'artists', 'album', 'year', 'comment', 'genre']

function dropId3v1(meta) {
  if (!meta?.native?.ID3v1) return meta
  delete meta.native.ID3v1
  if (Array.isArray(meta.format?.tagTypes)) meta.format.tagTypes = meta.format.tagTypes.filter(type => type !== 'ID3v1')
  // skipPostHeaders reads ID3v1 only when the file has no other tags, so every
  // one of these came from it.
  if (!Object.keys(meta.native).length && meta.common) {
    for (const field of ID3V1_FIELDS) delete meta.common[field]
    meta.common.track = { no: null, of: null }
  }
  return meta
}

// Skip the tags at the end of the file (where ID3v1 lives) whenever earlier ones were found.
const withOptions = options => ({ ...(options || {}), skipPostHeaders: true })

module.exports = {
  ...mm,
  parseFile: (filePath, options) => mm.parseFile(filePath, withOptions(options)).then(dropId3v1),
  parseBuffer: (buffer, fileInfo, options) => mm.parseBuffer(buffer, fileInfo, withOptions(options)).then(dropId3v1),
  parseStream: (stream, fileInfo, options) => mm.parseStream(stream, fileInfo, withOptions(options)).then(dropId3v1),
}
