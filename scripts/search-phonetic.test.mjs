import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { swapLayout, translit, skeleton } = require('../electron/phonetic.js')
const { correctSpelling } = require('../electron/librarySearch.js')
const { ensureSearchIndex } = require('../electron/searchIndex.js')
const { spelling } = require('../electron/online/spelling.js')

function library(rows) {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE tracks (id TEXT, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, play_count INT, comment TEXT); CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)')
  ensureSearchIndex(db)
  const add = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, 0, NULL)')
  rows.forEach((row, i) => add.run(String(i), `/music/${i}.flac`, row.title, row.artist, row.album || null, null))
  return db
}
const db = library([
  { title: 'Bass Bumpin', artist: 'Jaenga' },
  { title: 'Tiny Foldable Cities', artist: 'Orbital' },
  { title: 'Ten Tons', artist: 'Town Band' },
  { title: 'Группа крови', artist: 'Кино' },
  { title: 'Knights of Cydonia', artist: 'Muse' },
  { title: 'Бассейн', artist: 'Чайф' },
  { title: 'Бампер', artist: 'Чайф' },
  { title: 'Tin Soldier', artist: 'Small Faces' },
])

test('the other keyboard layout, both ways', () => {
  assert.equal(swapLayout('ифыы игьзшт'), 'bass bumpin')
  assert.equal(swapLayout('rbyj'), 'кино')
  assert.equal(swapLayout('[jhjij'), 'хорошо')
  assert.equal(swapLayout('123'), null)
})

test('words sound the same in either alphabet', () => {
  assert.equal(translit('фолдэбл'), 'foldebl')
  const same = [['басс', 'Bass'], ['бампин', 'Bumpin'], ['тайни', 'Tiny'], ['фолдэбл', 'Foldable'], ['ситис', 'Cities'],
    ['орбитал', 'Orbital'], ['джаенга', 'Jaenga'], ['кино', 'kino'], ['найтс', 'Knights'], ['квин', 'Queen'], ['вотч', 'Watch'], ['шоу', 'Show']]
  for (const [ru, en] of same) assert.equal(skeleton(ru), skeleton(en), `${ru} / ${en}`)
  assert.notEqual(skeleton('басс'), skeleton('Tiny'))
})

test('a Russian-sounding query finds the English names', () => {
  assert.equal(correctSpelling(db, 'басс бампин'), 'bass bumpin')
  assert.equal(correctSpelling(db, 'тайни фолдэбл ситис'), 'tiny foldable cities')
  assert.equal(correctSpelling(db, 'орбитал'), 'orbital')
  assert.equal(correctSpelling(db, 'джаенга басс'), 'jaenga bass')
  assert.equal(correctSpelling(db, 'найтс оф сидония'), 'knights of cydonia')
})

test('words that are also part of words as typed ("бассейн") still sound like the names', () => {
  assert.equal(correctSpelling(db, 'басс бамп'), 'bass bumpin')
  assert.equal(correctSpelling(db, 'тайни'), 'tiny') // not "tin"
})

test('the last word may be half typed', () => {
  assert.equal(correctSpelling(db, 'басс бамп'), 'bass bumpin')
  assert.equal(correctSpelling(db, 'тайни фолд'), 'tiny foldable')
})

test('a Latin query finds Russian names, and a wrong layout is swapped', () => {
  assert.equal(correctSpelling(db, 'kino gruppa krovi'), 'кино группа крови')
  assert.equal(correctSpelling(db, 'ифыы игьзшт'), 'bass bumpin')
  assert.equal(correctSpelling(db, 'uheggf'), 'группа')
})

test('nothing sounding alike: no correction', () => {
  assert.equal(correctSpelling(db, 'бас бампин'), 'bass bumpin') // one letter short still sounds the same
  assert.equal(correctSpelling(db, 'металлика'), null)
  assert.equal(correctSpelling(db, 'tiny foldable'), null) // found as typed
})

test('the search bar gets it as a library correction', async () => {
  const fetchImpl = async () => { throw new Error('no network') }
  assert.deepEqual(await spelling(db, 'басс бампин', { fetchImpl }), { corrected: 'bass bumpin', source: 'library' })
})
