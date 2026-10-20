// Online radio's local history (electron/radio/history.js): the songs each
// station played, newest first, 100 at most, one file per station.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')
const history = require('../electron/radio/history.js')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-radio-history-'))
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = path.join(dir, 'data')
  initDB()
  t.after(() => {
    getDB().close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

test('each station keeps its last 100 songs, newest first', (t) => {
  fixture(t)
  for (let i = 0; i < 105; i++) history.add('st1', 'Station One', { artist: `Artist ${i}`, title: `Song ${i}` }, 1000 + i)
  history.add('st2', 'Station Two', { artist: 'A', title: 'B' }, 5)
  const one = history.get('st1')
  assert.equal(one.station, 'Station One')
  assert.equal(one.entries.length, 100)
  assert.deepEqual(one.entries[0], { artist: 'Artist 104', title: 'Song 104', at: 1104 })
  assert.equal(one.entries[99].title, 'Song 5')
  assert.deepEqual(Object.keys(one.entries[0]).sort(), ['artist', 'at', 'title'], 'nothing but the artist, title and time')
  assert.deepEqual(history.stationIds().sort(), ['st1', 'st2'])
  assert.deepEqual(history.get('none').entries, [])
})

test('the same song named again soon after is not a new play', (t) => {
  fixture(t)
  assert.equal(history.add('st1', 'S', { artist: 'A', title: 'B' }, 0).added, true)
  assert.equal(history.add('st1', 'S', { artist: 'a', title: 'b ' }, 60 * 1000).added, false)
  assert.equal(history.add('st1', 'S', { artist: 'A', title: 'B' }, 60 * 60 * 1000).added, true)
  assert.equal(history.get('st1').entries.length, 2)
})
