// Library search (the search bar's songs, albums and artists, desktop and web),
// on the search index (electron/searchIndex.js): every word of the query must
// begin a word of the title, artist, album, album artist, comment or lyrics,
// in any order, so "fame is for fools hallex" finds Hallex M's "Fame Is for
// Fools" (title words and an artist word). Songs found by their names come
// first -- the whole query in the title, then in another name, then all its
// words in the names -- and songs found only by their comment or lyrics last.

const { matchExpression, queryWords, fold } = require('./searchIndex')

/** "Fame is  for Fools" -> ['fame', 'is', 'for', 'fools'] */
const searchWords = queryWords

// Words compared without case or accents: "Beyoncé" / "beyonce".
const WORD_CHARS = /[\p{L}\p{N}]+/gu
const plainWords = text => fold(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(WORD_CHARS) || []
const joined = text => ` ${plainWords(text).join(' ')}`

/**
 * SQL (on `tracks`) for songs with every word in one of `columns` of the
 * index: { sql, params }, or null for an empty query.
 */
function wordsMatch(query, columns) {
  const match = matchExpression(query, columns)
  if (!match) return null
  return {
    sql: 'id IN (SELECT d.track_id FROM track_search_docs d WHERE d.doc IN (SELECT rowid FROM track_search WHERE track_search MATCH ?))',
    params: [match],
  }
}

const NAMES = ['title', 'artist', 'album', 'album_artist']

/** 0: the query in the title, 1: in another name, 2: its words in the names, 3: found by comment or lyrics. */
function rankOf(track, words) {
  const phrase = ` ${words.join(' ')}`
  const names = NAMES.map(column => joined(track[column]))
  if (names[0].includes(phrase)) return 0
  if (names.some(name => name.includes(phrase))) return 1
  const nameWords = names.join(' ').split(' ')
  return words.every(word => nameWords.some(name => name.startsWith(word))) ? 2 : 3
}

/** Library songs for `query` (not streamed ones), best matches first: all of them unless `limit`. */
function searchTracks(db, query, limit = Infinity) {
  const match = matchExpression(query)
  if (!match) return []
  let rows
  try {
    rows = db.prepare(`SELECT t.* FROM track_search s JOIN track_search_docs d ON d.doc = s.rowid JOIN tracks t ON t.id = d.track_id
      WHERE track_search MATCH ? ORDER BY bm25(track_search, 10, 8, 4, 4, 1, 1), IFNULL(t.play_count, 0) DESC, t.title COLLATE NOCASE`).all(match)
  } catch (e) {
    console.warn('[librarySearch] Search failed:', e.message)
    return []
  }
  const words = plainWords(query)
  return rows
    .map((track, order) => ({ track, order, rank: rankOf(track, words) }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, limit)
    .map(found => found.track)
}

/**
 * Artists for `query`: the query begins a word of the name, or the artist
 * sings one of the songs found and a word of their name is one of its words
 * ("... hallex" -> Hallex M).
 */
function searchArtists(db, query, tracks = [], limit = 5) {
  const words = plainWords(query)
  if (!words.length) return []
  const phrase = ` ${words.join(' ')}`
  const artists = db.prepare(`SELECT a.*, COUNT(atl.track_id) as track_count FROM artists a JOIN artist_track_links atl ON atl.artist_id = a.id
    GROUP BY a.id`).all()
  const exactFirst = artist => (joined(artist.name) === phrase ? 0 : joined(artist.name).startsWith(phrase) ? 1 : 2)
  const byName = artists.filter(artist => joined(artist.name).includes(phrase))
    .sort((a, b) => exactFirst(a) - exactFirst(b) || b.track_count - a.track_count)
    .slice(0, limit)
  const ids = tracks.map(track => track.id).slice(0, 40)
  // Short words ("is", "of") are in too many names to say anything.
  const named = words.filter(word => word.length >= 3)
  if (byName.length >= limit || !ids.length || !named.length) return byName
  const singers = new Set(db.prepare(`SELECT DISTINCT artist_id FROM artist_track_links WHERE track_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).map(row => row.artist_id))
  const seen = new Set(byName.map(a => a.id))
  const ofSongs = artists.filter(artist => singers.has(artist.id) && !seen.has(artist.id)
    && plainWords(artist.name).some(name => named.some(word => name.startsWith(word))))
  return [...byName, ...ofSongs].slice(0, limit)
}

module.exports = { searchWords, wordsMatch, searchTracks, searchArtists }

// ---------------------------------------------------------------- spelling

// "micheal jackson" finds nothing: each word that's in no title, artist or
// album is replaced by the library's closest word (one or two letters off:
// a typo, a swap) -- "michael jackson". The words come from the library's
// own names, so a correction is always something it has.

const WORD = /[\p{L}\p{N}']+/gu
let vocabulary = null // { stamp, words: Map(word -> uses) }

function libraryWords(db) {
  const stamp = (() => { try { const r = db.prepare("SELECT COUNT(*) AS n, MAX(rowid) AS last FROM tracks WHERE file_path NOT LIKE 'ghost://%'").get(); return `${r.n}:${r.last}` } catch { return '' } })()
  if (vocabulary && vocabulary.stamp === stamp) return vocabulary.words
  const words = new Map()
  const rows = (() => { try { return db.prepare("SELECT title, artist, album, album_artist FROM tracks WHERE file_path NOT LIKE 'ghost://%'").all() } catch { return [] } })()
  for (const row of rows) {
    for (const text of [row.title, row.artist, row.album, row.album_artist]) {
      for (const word of String(text || '').toLowerCase().match(WORD) || []) {
        if (word.length >= 3) words.set(word, (words.get(word) || 0) + 1)
      }
    }
  }
  vocabulary = { stamp, words }
  return words
}

/** Edit distance with swaps ("micheal" / "michael" = 1), stopping past `max`. */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows = [Array.from({ length: b.length + 1 }, (_, j) => j)]
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let value = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, rows[i - 2][j - 2] + 1)
      row.push(value)
      if (value < best) best = value
    }
    if (best > max) return max + 1
    rows.push(row)
  }
  return rows[a.length][b.length]
}

/**
 * `query` with its misspelt words replaced by the library's closest ones, or
 * null when it needs none (or nothing close enough exists, or the corrected
 * query wouldn't find anything either).
 */
function correctSpelling(db, query) {
  const words = String(query || '').toLowerCase().match(WORD) || []
  if (!words.length || searchTracks(db, query, 1).length) return null
  const known = libraryWords(db)
  const keys = [...known.keys()]
  let changed = false
  const fixed = words.map(word => {
    if (word.length < 4 || keys.some(k => k.includes(word))) return word
    const max = word.length >= 8 ? 2 : 1
    let best = null
    for (const [candidate, uses] of known) {
      const d = distance(word, candidate, max)
      if (d <= max && (!best || d < best.d || (d === best.d && uses > best.uses))) best = { word: candidate, d, uses }
    }
    if (!best) return word
    changed = true
    return best.word
  })
  if (!changed) return null
  const corrected = fixed.join(' ')
  return searchTracks(db, corrected, 1).length ? corrected : null
}

module.exports.correctSpelling = correctSpelling
