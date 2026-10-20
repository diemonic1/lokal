// Full-size song covers left in the covers cache from before thumbnails (see
// thumb.js): each one whose song file has the picture in it becomes a 150x150
// WebP made from the file's picture, and the big file goes. Runs once in a
// while after launch and with Cache Analysis's safe clean-up. Artist pictures,
// playlist and album covers chosen by hand, covers from the music folder and
// covers of songs whose file has no picture (found online, set on an online
// song) are left as they are.

const fs = require('fs')
const path = require('path')

const HAND_PICKED = /^(artist|playlist|album)-/i

const isLocalFile = filePath => !!filePath && !/^(ghost|https?|radio):/i.test(String(filePath)) && fs.existsSync(filePath)

/**
 * The full-size covers in `artworkDir` that could become thumbnails:
 * -> [{ path, size, filePaths: [song files using it] }]. Only cheap checks
 * (no file is read), so Cache Analysis can count them.
 */
// Covers looked at before whose song file has no picture: the cached one is
// the only full copy (kept in settings, so they aren't read again each time).
const FULL_ONLY_KEY = 'artwork_full_only'
function fullOnly(db) {
  try { return new Set(JSON.parse(db.prepare('SELECT value FROM settings WHERE key = ?').get(FULL_ONLY_KEY)?.value || '[]')) } catch { return new Set() }
}
function saveFullOnly(db, keys) {
  try { db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(FULL_ONLY_KEY, JSON.stringify([...keys])) } catch {}
}

function shrinkableCovers(db, artworkDir) {
  const dir = path.resolve(artworkDir).toLowerCase()
  const skip = fullOnly(db)
  const byCover = new Map()
  let rows = []
  try { rows = db.prepare("SELECT artwork_path, file_path FROM tracks WHERE artwork_path IS NOT NULL AND artwork_path != ''").all() } catch { return [] }
  for (const row of rows) {
    const art = path.resolve(String(row.artwork_path))
    const key = art.toLowerCase()
    // A full cover kept after it was opened big (artwork/fullCover.js) stays full.
    if (path.dirname(key) !== dir || /\.webp$/i.test(art) || /\.full\.[a-z]+$/i.test(art) || HAND_PICKED.test(path.basename(art)) || skip.has(key)) continue
    if (!byCover.has(key)) byCover.set(key, { path: art, size: 0, filePaths: [], usable: true })
    const entry = byCover.get(key)
    if (isLocalFile(row.file_path)) entry.filePaths.push(row.file_path)
    else entry.usable = false // an online song (or a missing file) needs the picture as it is
  }
  const out = []
  for (const entry of byCover.values()) {
    if (!entry.usable || !entry.filePaths.length) continue
    try { entry.size = fs.statSync(entry.path).size } catch { continue }
    out.push({ path: entry.path, size: entry.size, filePaths: entry.filePaths })
  }
  return out
}

/**
 * Turns the shrinkable covers into thumbnails. -> { converted, freed, skipped,
 * trackIds } (freed: bytes, the thumbnails' size taken off; trackIds: the
 * songs whose cover path changed).
 */
async function shrinkCovers(db, artworkDir, { onProgress } = {}) {
  if (running) return running
  running = shrinkAll(db, artworkDir, onProgress).finally(() => { running = null })
  return running
}

let running = null
async function shrinkAll(db, artworkDir, onProgress) {
  const { filePicture } = require('./fullCover')
  const { writeCover } = require('./thumb')
  const list = shrinkableCovers(db, artworkDir)
  let converted = 0
  let freed = 0
  let skipped = 0
  const update = db.prepare('UPDATE tracks SET artwork_path = ? WHERE artwork_path = ?')
  // The ways each cover's path is written in the rows (compared as strings),
  // and the pictures artists and playlists use (never removed).
  const spellings = new Map()
  const songs = new Map()
  const keep = new Set()
  const trackIds = []
  const noPicture = new Set()
  if (list.length) {
    for (const row of db.prepare("SELECT id, artwork_path AS p FROM tracks WHERE artwork_path IS NOT NULL AND artwork_path != ''").all()) {
      const key = path.resolve(String(row.p)).toLowerCase()
      if (!spellings.has(key)) { spellings.set(key, new Set()); songs.set(key, []) }
      spellings.get(key).add(row.p)
      songs.get(key).push(row.id)
    }
    for (const sql of ['SELECT image_path AS p FROM artists', 'SELECT cover_path AS p FROM playlists']) {
      try { for (const r of db.prepare(sql).all()) if (r.p) keep.add(path.resolve(String(r.p)).toLowerCase()) } catch {}
    }
  }
  for (let i = 0; i < list.length; i++) {
    const cover = list[i]
    onProgress?.({ done: i, total: list.length })
    // Reading tags blocks for a moment: the app keeps answering in between.
    await new Promise(resolve => setImmediate(resolve))
    let picture = null
    for (const filePath of cover.filePaths) {
      picture = await filePicture(filePath)
      if (picture) break
    }
    // Not in the file: the cached picture is the only full copy, so it stays.
    if (!picture) { skipped++; noPicture.add(cover.path.toLowerCase()); continue }
    const base = path.basename(cover.path).replace(/\.[^.]+$/, '')
    let thumbPath
    try { thumbPath = await writeCover(path.dirname(cover.path), base, picture) } catch { skipped++; continue }
    if (!/\.webp$/i.test(thumbPath)) { skipped++; continue } // no sharp: nothing smaller to put there
    const key = cover.path.toLowerCase()
    db.transaction(() => { for (const raw of spellings.get(key) || []) update.run(thumbPath, raw) })()
    trackIds.push(...(songs.get(key) || []))
    if (!keep.has(key)) {
      let thumbSize = 0
      try { thumbSize = fs.statSync(thumbPath).size } catch {}
      try { fs.unlinkSync(cover.path); freed += Math.max(0, cover.size - thumbSize) } catch {}
    }
    converted++
  }
  if (noPicture.size) {
    // Only the ones still in the cache are remembered.
    const known = [...fullOnly(db)].filter(key => fs.existsSync(key))
    saveFullOnly(db, new Set([...known, ...noPicture]))
  }
  onProgress?.({ done: list.length, total: list.length })
  return { converted, freed, skipped, trackIds }
}

module.exports = { shrinkableCovers, shrinkCovers }
