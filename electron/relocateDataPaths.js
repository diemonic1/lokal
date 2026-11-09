// Pictures and files Lokal keeps in its data folder are stored in the database
// with their full path (C:\Users\...\Roaming\lokal-music\data\artwork\artist-x.jpg).
// When the data folder has moved -- copied next to the exe (AppData, see
// portableData.js), or the app's folder moved elsewhere -- those paths point
// at a folder that's gone. At launch each one whose file isn't there is pointed
// at the same file in the data folder now, when that one is there.

const fs = require('fs')
const path = require('path')

const DATA_PATH_COLUMNS = [
  ['artists', 'image_path'], ['tracks', 'artwork_path'], ['playlists', 'cover_path'],
  ['users', 'avatar_path'], ['downloaded_playlists', 'archive_path'],
]

/** The part of an old path after its last "data" folder: ['artwork', 'artist-x.jpg'], or null. */
function insideData(old) {
  const parts = String(old).split(/[\\/]+/)
  const at = parts.map(part => part.toLowerCase()).lastIndexOf('data')
  return at >= 0 && at < parts.length - 1 ? parts.slice(at + 1) : null
}

function relocateDataPaths(db, dataDir) {
  const here = path.resolve(dataDir)
  const prefix = here.toLowerCase() + path.sep
  let moved = 0
  for (const [table, column] of DATA_PATH_COLUMNS) {
    let rows = []
    try { rows = db.prepare(`SELECT rowid AS id, "${column}" AS p FROM "${table}" WHERE "${column}" IS NOT NULL AND "${column}" != ''`).all() } catch { continue }
    const changes = []
    for (const row of rows) {
      const old = String(row.p)
      // Links (https://...) and paths already in the data folder stay.
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(old) || path.resolve(old).toLowerCase().startsWith(prefix)) continue
      const rest = insideData(old)
      if (!rest) continue
      let there = true
      try { there = fs.existsSync(old) } catch {}
      if (there) continue
      const next = path.join(here, ...rest)
      if (fs.existsSync(next)) changes.push([next, row.id])
    }
    if (!changes.length) continue
    const update = db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE rowid = ?`)
    db.transaction(list => { for (const args of list) update.run(...args) })(changes)
    moved += changes.length
  }
  if (moved) console.log(`[db] ${moved} paths now point at the data folder's new place (${here})`)
  return moved
}

module.exports = { relocateDataPaths, insideData }
