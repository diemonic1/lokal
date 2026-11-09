import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { relocateDataPaths, insideData } = require('../electron/relocateDataPaths.js')

function fakeDb(tables) {
  return {
    prepare(sql) {
      const table = /FROM "(\w+)"/.exec(sql)?.[1] || /UPDATE "(\w+)"/.exec(sql)?.[1]
      if (sql.startsWith('SELECT')) return { all: () => tables[table] || [] }
      return { run: (next, id) => { tables[table].find(row => row.id === id).p = next } }
    },
    transaction: fn => list => fn(list),
  }
}

test('paths into a data folder that moved point at the same file in the new one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-relocate-'))
  const data = path.join(dir, 'AppData', 'data')
  fs.mkdirSync(path.join(data, 'artwork'), { recursive: true })
  fs.writeFileSync(path.join(data, 'artwork', 'artist-a.jpg'), 'x')
  const tables = { artists: [
    { id: 1, p: 'C:\\Users\\someone\\AppData\\Roaming\\lokal-music\\data\\artwork\\artist-a.jpg' },
    { id: 2, p: 'C:\\Users\\someone\\AppData\\Roaming\\lokal-music\\data\\artwork\\artist-missing.jpg' },
    { id: 3, p: 'https://example.com/data/a.jpg' },
  ] }
  assert.equal(relocateDataPaths(fakeDb(tables), data), 1)
  assert.equal(tables.artists[0].p, path.join(data, 'artwork', 'artist-a.jpg'))
  assert.match(tables.artists[1].p, /Roaming/)
  assert.equal(tables.artists[2].p, 'https://example.com/data/a.jpg')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('the part after the last data folder', () => {
  assert.deepEqual(insideData('C:/old/Data/lokal-music/data/artwork/a.jpg'), ['artwork', 'a.jpg'])
  assert.equal(insideData('C:/music/cover.jpg'), null)
})
