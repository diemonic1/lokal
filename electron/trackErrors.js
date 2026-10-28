// Songs that can't be played: their file is gone, or the last attempt to play
// them failed (a file the player couldn't decode even after conversion, a
// stream no source could play). Library → "Songs with errors" lists them.

function ensure(db) {
  db.exec('CREATE TABLE IF NOT EXISTS track_errors (track_id TEXT PRIMARY KEY, message TEXT NOT NULL, at INTEGER NOT NULL)')
}

function recordTrackError(db, trackId, message) {
  if (!trackId) return false
  ensure(db)
  db.prepare('INSERT OR REPLACE INTO track_errors (track_id, message, at) VALUES (?, ?, ?)').run(String(trackId), String(message || "Couldn't play this song").slice(0, 300), Date.now())
  return true
}

function clearTrackError(db, trackId) {
  ensure(db)
  return db.prepare('DELETE FROM track_errors WHERE track_id = ?').run(String(trackId)).changes > 0
}

function trackErrors(db) {
  ensure(db)
  return new Map(db.prepare('SELECT track_id, message FROM track_errors').all().map(row => [row.track_id, row.message]))
}

/**
 * The tracks query for the library list. With `problems`, only songs that
 * can't be played, each with why (missing / playback_error); ordering and
 * paging then happen after the file check.
 */
// Sorts the library asks for; anything else falls back to the default
// rather than reaching ORDER BY (the web route passes the query string).
const SORT = /^(id|added_at|title|artist|album|album_artist|play_count|duration|year|last_modified|bitrate|track_num)(\s+(ASC|DESC))?$/i
// "lyrics": songs without lyrics in the file first, then unfound, instrumental,
// plain, line synced, syllable synced (LYRICS_RANK in src/trackChanged.js).
const LYRICS_SORT = "CASE lyrics_kind WHEN 'syllable' THEN 5 WHEN 'sync' THEN 4 WHEN 'plain' THEN 3 WHEN 'instrumental' THEN 2 WHEN 'unfound' THEN 1 ELSE 0 END ASC, artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC"
// "clip": songs with a music video set (Edit Track > Clip) first, then those
// with a moving cover, by where it's from (Spotify Canvas, Apple Music, Tidal,
// the community list), then the rest (CLIP_RANK in src/trackChanged.js).
const CLIP_SORT = "CASE WHEN TRIM(COALESCE(clip_url, '')) <> '' THEN 0 WHEN spotify_canvas = 1 OR motion_cover_source = 'spotify' THEN 1 WHEN motion_cover_source = 'apple' THEN 2 WHEN motion_cover_source = 'tidal' THEN 3 WHEN motion_cover_source IS NOT NULL AND motion_cover_source <> '' THEN 4 ELSE 5 END ASC, artist COLLATE NOCASE ASC, title COLLATE NOCASE ASC"
const safeSort = value => {
  const v = String(value || '').trim()
  if (/^lyrics(\s+ASC)?$/i.test(v)) return LYRICS_SORT
  if (/^clip(\s+ASC)?$/i.test(v)) return CLIP_SORT
  return SORT.test(v) ? v : 'added_at DESC'
}
const truthy = value => value === true || value === 'true' || value === '1' || value === 1

function listTracks(db, opts, { where, params, exists }) {
  const { missingTrackFile } = require('./libraryTracks')
  // "Add songs" asks for up to 5,000 at once.
  const limit = Math.max(1, Math.min(5000, parseInt(opts.limit, 10) || 500))
  const offset = Math.max(0, parseInt(opts.offset, 10) || 0)
  const errors = trackErrors(db)
  const decorate = track => ({ ...track, missing: missingTrackFile(track, exists), ...(errors.has(String(track.id)) ? { playback_error: errors.get(String(track.id)) } : {}) })
  const problems = truthy(opts.problems)
  // The genre filter is a JS function in SQL (see genreList.js).
  if (where.some(clause => String(clause).includes('lokal_has_genre'))) require('./genreList').registerGenreFunctions(db)
  const clauses = [...where]
  if (problems) clauses.push("(file_path NOT LIKE 'ghost://%' OR id IN (SELECT track_id FROM track_errors))")
  let sql = 'SELECT * FROM tracks'
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ')
  // { count }: how many songs match, instead of a page of them.
  if (truthy(opts.count) && !problems) return { count: db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) AS n')).get(...params)?.n || 0 }
  sql += ` ORDER BY ${safeSort(opts.sort)}`
  if (!problems) return db.prepare(`${sql} LIMIT ${limit} OFFSET ${offset}`).all(...params).map(decorate)
  const failing = db.prepare(sql).all(...params).map(decorate).filter(track => track.missing || track.playback_error)
  if (truthy(opts.count)) return { count: failing.length }
  return failing.slice(offset, offset + limit)
}

module.exports = { recordTrackError, clearTrackError, trackErrors, listTracks, truthy, safeSort }
