// After a scan: songs whose file is gone from the music folder leave the
// library. A file that was only moved or renamed (a folder renamed, say) was
// indexed again under its new path by the scan; the old entry hands its
// likes, plays and playlist places to that one before it goes. Without a new
// copy the entry is removed like a song deleted in Lokal.
//
// Nothing is removed when the scan found no files at all: the music folder
// (or its drive) being unavailable must not empty the library.

const fs = require('fs')
const path = require('path')

/** Every table with a track_id column (likes, plays, playlists, lyrics...). */
function trackTables(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'tracks'").all().map(row => row.name)
  return tables.filter(name => {
    try { return db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all().some(column => column.name === 'track_id') } catch { return false }
  })
}

const sameSong = (a, b) =>
  String(a.title || '').trim().toLowerCase() === String(b.title || '').trim().toLowerCase() &&
  String(a.artist || '').trim().toLowerCase() === String(b.artist || '').trim().toLowerCase() &&
  (!a.duration || !b.duration || Math.abs(Number(a.duration) - Number(b.duration)) < 2)

/**
 * @param folderPath    the music folder just scanned
 * @param scannedFiles  the audio files the scan found in it
 * -> { removed, moved }
 */
function pruneMissingTracks(db, folderPath, scannedFiles, { exists = fs.existsSync } = {}) {
  if (!folderPath || !Array.isArray(scannedFiles) || !scannedFiles.length || !exists(folderPath)) return { removed: 0, moved: 0 }
  const root = path.resolve(folderPath)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const upper = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1)
  const found = new Set(scannedFiles.map(file => path.resolve(file).toLowerCase()))
  const rows = db.prepare("SELECT * FROM tracks WHERE file_path >= ? AND file_path < ? AND file_path NOT LIKE 'ghost://%'").all(prefix, upper)
  const stale = rows.filter(row => !found.has(path.resolve(row.file_path).toLowerCase()) && !exists(row.file_path))
  if (!stale.length) return { removed: 0, moved: 0 }
  const present = rows.filter(row => !stale.includes(row))
  const tables = trackTables(db)
  let moved = 0
  const run = db.transaction(() => {
    for (const old of stale) {
      const copy = present.find(row => sameSong(row, old))
      for (const table of tables) {
        const quoted = `"${table.replace(/"/g, '""')}"`
        if (copy) { try { db.prepare(`UPDATE OR IGNORE ${quoted} SET track_id = ? WHERE track_id = ?`).run(copy.id, old.id) } catch {} }
        try { db.prepare(`DELETE FROM ${quoted} WHERE track_id = ?`).run(old.id) } catch {}
      }
      if (copy) {
        db.prepare('UPDATE tracks SET play_count = COALESCE(play_count, 0) + ? WHERE id = ?').run(Number(old.play_count) || 0, copy.id)
        moved++
      }
      db.prepare('DELETE FROM tracks WHERE id = ?').run(old.id)
    }
    // Artists left without a song go too.
    try { db.prepare('DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM artist_track_links)').run() } catch {}
  })
  run()
  return { removed: stale.length - moved, moved }
}

module.exports = { pruneMissingTracks }
