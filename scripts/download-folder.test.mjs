// Settings > Library > Downloads > Download Folder: a finished download goes
// into the chosen library folder, numbered on from its biggest track number
// (electron/folderTracks.js placeDownload).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { placeDownload } = require('../electron/folderTracks.js')
const { DatabaseSync } = require('node:sqlite')
const T = require('node-taglib-sharp')

// A tiny MP3: frames of MPEG-1 Layer III, 128 kbps, 44.1 kHz (417 bytes each).
function mp3(filePath) {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x64])
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, Buffer.concat(Array.from({ length: 20 }, () => frame)))
}

const trackOf = filePath => {
  const file = T.File.createFromPath(filePath)
  try { return file.tag.track } finally { file.dispose() }
}

test('a download goes into the chosen folder, numbered after its songs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-download-folder-'))
  try {
    const db = new DatabaseSync(':memory:')
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT); CREATE TABLE tracks (id TEXT, file_path TEXT, track_num INTEGER)")
    db.prepare("INSERT INTO settings VALUES ('music_folder', ?)").run(root)
    const existing = path.join(root, 'Mix', 'old.mp3')
    mp3(existing)
    db.prepare('INSERT INTO tracks VALUES (?, ?, ?)').run('old', existing, 7)

    // Two downloads before either is in the library (a playlist): 8, then 9.
    const first = path.join(root, 'Artist', 'Album', 'first.mp3')
    const second = path.join(root, 'Artist', 'Album', 'second.mp3')
    mp3(first)
    mp3(second)
    fs.writeFileSync(first.replace(/\.mp3$/, '.lrc'), '[00:01.00]hi')
    const placedFirst = placeDownload(db, first, 'Mix')
    const placedSecond = placeDownload(db, second, 'Mix')

    assert.equal(placedFirst, path.join(root, 'Mix', 'first.mp3'))
    assert.equal(placedSecond, path.join(root, 'Mix', 'second.mp3'))
    assert.ok(!fs.existsSync(first))
    assert.ok(fs.existsSync(path.join(root, 'Mix', 'first.lrc')), 'its lyrics file goes with it')
    assert.equal(trackOf(placedFirst), 8)
    assert.equal(trackOf(placedSecond), 9)

    // A folder outside the music folder: left where it is.
    const stray = path.join(root, 'Artist', 'stray.mp3')
    mp3(stray)
    assert.equal(placeDownload(db, stray, '../elsewhere'), stray)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
