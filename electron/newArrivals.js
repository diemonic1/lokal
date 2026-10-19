// The New tab (src/pages/NewArrivals.jsx): songs by when they joined the
// library (tracks.added_at), and the artists who are new to it.

const fs = require('fs')
const { listTracks } = require('./trackErrors')

const DAY = 86400
// "Recently added" when it's shown in full.
const RECENT_LIMIT = 50
const FILES_ONLY = "file_path NOT LIKE 'ghost://%'"

/**
 * -> { now, recent, year, newArtists }
 *   recent      the last RECENT_LIMIT songs added
 *   year        every song added in the last 365 days, newest first (the page
 *               takes the week and the month out of it)
 *   newArtists  artists whose every song came in the last 30 days: someone
 *               with an older song in the library isn't new
 * @param mapArtist turns an artist row into what the page shows (its picture...)
 */
function newArrivals(db, { now = Math.floor(Date.now() / 1000), mapArtist = artist => artist, exists = fs.existsSync } = {}) {
  const recent = listTracks(db, { sort: 'added_at DESC', limit: RECENT_LIMIT }, { where: [FILES_ONLY], params: [], exists })
  const year = listTracks(db, { sort: 'added_at DESC', limit: 5000 }, { where: [FILES_ONLY, 'added_at >= ?'], params: [now - 365 * DAY], exists })
  const newArtists = db.prepare(`
    SELECT a.*, COUNT(DISTINCT t.id) AS track_count, MIN(t.added_at) AS first_added
    FROM artists a
    JOIN artist_track_links atl ON atl.artist_id = a.id
    JOIN tracks t ON t.id = atl.track_id AND t.file_path NOT LIKE 'ghost://%'
    GROUP BY a.id
    HAVING MIN(t.added_at) >= ?
    ORDER BY first_added DESC, a.name COLLATE NOCASE
  `).all(now - 30 * DAY).map(mapArtist)
  return { now, recent, year, newArtists }
}

module.exports = { newArrivals, DAY }
