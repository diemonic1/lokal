// A song's time markers -- moments with a caption, like the songs of a mix
// ("[03:00.00] Artist - Title"), which the player bar's markers button jumps
// between -- live in the file itself, in Lokal's own LOKAL_MARKERS tag, the
// way the explicit mark lives in LOKAL_TRACK (see ./trackExtras.js): ID3v2
// TXXX, a Vorbis field, an iTunes freeform atom. Other players ignore it; a
// rescan (or a fresh library) reads them back from the file.
//
// The tag is the text as typed, one marker a line, like synced lyrics:
// "[mm:ss.xx] caption". tracks.markers is its copy in the library.

const TAG = 'LOKAL_MARKERS'
const IDS = new Set([`TXXX:${TAG}`, TAG, `----:com.apple.iTunes:${TAG}`])

const tagText = (value) => (typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '')

/** The text as it's kept: line breaks made \n, empty lines and edges trimmed; null when empty. */
function normalize(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n')
  return clean || null
}

/** The markers' text in a music-metadata result, or null when the file has none. */
function fromMeta(meta) {
  const values = Object.values(meta?.native || {}).flat()
    .filter(tag => tag && (IDS.has(tag.id) || String(tag.id).toUpperCase() === TAG))
    .flatMap(tag => (Array.isArray(tag.value) ? tag.value : [tag.value]))
    .map(tagText)
  // ID3v2.3 readers split TXXX text at "/" -- and a caption may hold them.
  return values.length ? normalize(values.join('/')) : null
}

/** Puts the file's markers into the library row of a just-read file. */
function applyToRow(db, trackId, markers) {
  db.prepare('UPDATE tracks SET markers = ? WHERE id = ?').run(markers ?? null, trackId)
}

module.exports = { TAG, normalize, fromMeta, applyToRow }
