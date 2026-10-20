// "Lokal.exe play_track <name>": the library song a name given on the command
// line means. Looked for, in this order, by its file's name (with or without
// the extension), its title, and "Artist - Title"; case doesn't matter. Only
// songs whose file is there: a streamed or missing one isn't played.

const fs = require('fs')
const path = require('path')

const norm = value => String(value || '').trim().replace(/^["']+|["']+$/g, '').trim().toLocaleLowerCase()

// A script saved as UTF-8 but read in the system's ANSI code page (a .vbs:
// Windows Script Host reads it so) hands over "СЃРєРµ…" / "â€¦" for
// anything outside that code page: スケラー arrives as "№г‚±гѓ©гѓј". Turned back
// into the bytes it was read from, and those read as UTF-8, it's the name again.
const ANSI_PAGES = ['windows-1251', 'windows-1252']
const byteMaps = new Map()
function byteMap(page) {
  if (!byteMaps.has(page)) {
    const map = new Map()
    try {
      const decoder = new TextDecoder(page)
      for (let byte = 0; byte < 256; byte++) map.set(decoder.decode(Uint8Array.of(byte)), byte)
    } catch {}
    byteMaps.set(page, map)
  }
  return byteMaps.get(page)
}
function repairedNames(name) {
  const found = []
  for (const page of ANSI_PAGES) {
    const map = byteMap(page)
    const bytes = []
    let ok = map.size > 0
    for (const char of String(name)) {
      const byte = map.get(char)
      if (byte === undefined) { ok = false; break }
      bytes.push(byte)
    }
    if (!ok) continue
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
      if (text !== name && !found.includes(text)) found.push(text)
    } catch {}
  }
  return found
}

/** The song (its row) and its folder relative to the music folder ('/'-separated), or null. */
function findTrackForCommand(db, name) {
  const found = findByName(db, name)
  if (found) return found
  for (const repaired of repairedNames(name)) {
    const match = findByName(db, repaired)
    if (match) return match
  }
  return null
}

function findByName(db, name) {
  const wanted = norm(name)
  if (!wanted) return null
  const rows = db.prepare("SELECT id, file_path, title, artist FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND file_path NOT LIKE 'http%'").all()
  const tests = [
    row => norm(path.basename(row.file_path)) === wanted,
    row => norm(path.parse(row.file_path).name) === wanted,
    row => norm(row.title) === wanted,
    row => norm(`${row.artist} - ${row.title}`) === wanted,
  ]
  let match = null
  for (const test of tests) {
    match = rows.find(row => test(row) && fs.existsSync(row.file_path))
    if (match) break
  }
  if (!match) return null
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(match.id)
  if (!track) return null
  let folder = ''
  const root = db.prepare("SELECT value FROM settings WHERE key = 'music_folder'").get()?.value
  if (root) {
    const relative = path.relative(path.resolve(String(root)), path.dirname(track.file_path))
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) folder = relative.split(path.sep).join('/')
  }
  return { track, folder }
}

module.exports = { findTrackForCommand }
