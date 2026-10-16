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

// The artist frames as the file holds them. music-metadata splits an ID3v2.3
// (or 2.2) artist at every "/" ("Protostar/Laminar/imallryt") and keeps only
// the first name as the artist: the whole text goes back in, so the library
// keeps the credit as written (the app splits it into artists itself, see
// ../artistSplit.js, and "AC/DC" stays one). Several values of a frame that
// really holds a list (ID3v2.4, Vorbis) are joined with "; ".
const ARTIST_FRAMES = {
  artist: { id3: ['TPE1', 'TP1'], vorbis: 'ARTIST', ape: 'Artist', mp4: '©ART' },
  albumartist: { id3: ['TPE2', 'TP2'], vorbis: 'ALBUMARTIST', ape: 'Album Artist', mp4: 'aART' },
}

function framesOf(type, frames) {
  if (/^ID3v2\.[23]$/.test(type)) return { ids: frames.id3, join: '/' }
  if (type === 'ID3v2.4') return { ids: frames.id3, join: '; ' }
  if (type === 'vorbis') return { ids: [frames.vorbis], join: '; ' }
  if (type === 'APEv2') return { ids: [frames.ape], join: '; ' }
  if (type === 'iTunes') return { ids: [frames.mp4], join: '; ' }
  return null
}

function rawArtistText(meta, field) {
  for (const [type, tags] of Object.entries(meta?.native || {})) {
    const frames = framesOf(type, ARTIST_FRAMES[field])
    if (!frames || !Array.isArray(tags)) continue
    const values = tags
      .filter(tag => frames.ids.some(id => String(tag?.id || '').toUpperCase() === id.toUpperCase()))
      .map(tag => (typeof tag.value === 'string' ? tag.value.trim() : ''))
      .filter(Boolean)
    if (values.length) return [...new Set(values)].join(frames.join)
  }
  return null
}

function keepArtistText(meta) {
  if (!meta?.common) return meta
  for (const field of Object.keys(ARTIST_FRAMES)) {
    const text = rawArtistText(meta, field)
    if (text && text !== meta.common[field]) meta.common[field] = text
  }
  return meta
}

const finish = meta => keepArtistText(dropId3v1(meta))

// Skip the tags at the end of the file (where ID3v1 lives) whenever earlier ones were found.
const withOptions = options => ({ ...(options || {}), skipPostHeaders: true })

module.exports = {
  ...mm,
  parseFile: (filePath, options) => mm.parseFile(filePath, withOptions(options)).then(finish),
  parseBuffer: (buffer, fileInfo, options) => mm.parseBuffer(buffer, fileInfo, withOptions(options)).then(finish),
  parseStream: (stream, fileInfo, options) => mm.parseStream(stream, fileInfo, withOptions(options)).then(finish),
}
