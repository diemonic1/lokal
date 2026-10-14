import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite')
const { searchTracks, searchArtists, wordsMatch, searchWords } = require('../electron/librarySearch.js')
const { ensureSearchIndex, setFileLyrics } = require('../electron/searchIndex.js')

function library() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, title TEXT, artist TEXT, album TEXT, album_artist TEXT, file_path TEXT, play_count INTEGER, comment TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE artist_track_links (artist_id TEXT, track_id TEXT);`)
  ensureSearchIndex(db)
  const add = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
  add.run('t1', 'Fame Is for Fools', 'Hallex M', 'Fame Is for Fools', 'Hallex M', '/m/fame.flac', 3)
  add.run('t2', 'Fools Gold', 'Stone Roses', 'Stone Roses', null, '/m/gold.flac', 9)
  add.run('t3', 'Is This Fame', 'Other Band', 'Fame Is for Fools Covers', null, '/m/cover.mp3', 1)
  add.run('t4', 'Fame Is for Fools', 'Hallex M', 'Fame Is for Fools', null, 'ghost://youtube/online/abcdefghijk', 0)
  add.run('t5', '100% Pure', 'Pure Act', 'Percent', null, '/m/pure.mp3', 0)
  add.run('t6', '1000 Pure', 'Pure Act', 'Percent', null, '/m/pure2.mp3', 0)
  db.exec(`INSERT INTO artists VALUES ('a1', 'Hallex M'), ('a2', 'Stone Roses'), ('a3', 'Other Band');
    INSERT INTO artist_track_links VALUES ('a1', 't1'), ('a2', 't2'), ('a3', 't3');`)
  return db
}

const ids = rows => rows.map(row => row.id)

test('words can come from the title and the artist, in any order', () => {
  const db = library()
  assert.deepEqual(ids(searchTracks(db, 'fame is for fools hallex')), ['t1'])
  assert.deepEqual(ids(searchTracks(db, 'hallex fools')), ['t1'])
  assert.deepEqual(ids(searchTracks(db, 'HALLEX   Fame')), ['t1'])
})

test('words can come from the album, and every word must be found', () => {
  const db = library()
  assert.deepEqual(ids(searchTracks(db, 'covers fame')), ['t3'])
  assert.deepEqual(ids(searchTracks(db, 'fools roses')), ['t2'])
  assert.deepEqual(searchTracks(db, 'fame nonsenseword'), [])
})

test('the whole query in the title comes first, and streamed copies are not library songs', () => {
  const db = library()
  // t3 has every word (title + album) but t1 has the phrase in its title.
  assert.deepEqual(ids(searchTracks(db, 'fame is for fools')), ['t1', 't3'])
})

test('punctuation is not searched, and % and _ are not wildcards', () => {
  const db = library()
  assert.deepEqual(ids(searchTracks(db, '100%')), ['t5', 't6'])
  assert.deepEqual(searchTracks(db, '%'), [])
  assert.deepEqual(searchTracks(db, '   '), [])
  assert.equal(wordsMatch('', ['title']), null)
  assert.deepEqual(searchWords('a  A b'), ['a', 'b'])
})

test('the artist of a found song shows when their name is one of the words', () => {
  const db = library()
  const tracks = searchTracks(db, 'fame is for fools hallex')
  assert.deepEqual(searchArtists(db, 'fame is for fools hallex', tracks).map(a => a.name), ['Hallex M'])
  // Short words alone ("is", "for") don't bring artists in.
  assert.deepEqual(searchArtists(db, 'fame is for fools', searchTracks(db, 'fame is for fools')).map(a => a.name), [])
  assert.deepEqual(searchArtists(db, 'stone', []).map(a => a.name), ['Stone Roses'])
})

test('Cyrillic is found in any case, ё as е, accents and apostrophes ignored', () => {
  const db = library()
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run('r1', 'Группа крови', 'Кино', 'Звезда по имени Солнце', null, '/m/kino.mp3', 0)
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run('r2', 'Ёлка', 'Beyoncé', "Don't Stop", null, '/m/elka.mp3', 0)
  assert.deepEqual(ids(searchTracks(db, 'кино')), ['r1'])
  assert.deepEqual(ids(searchTracks(db, 'ГРУППА КИН')), ['r1'])
  assert.deepEqual(ids(searchTracks(db, 'елка')), ['r2'])
  assert.deepEqual(ids(searchTracks(db, 'ёлка beyonce')), ['r2'])
  assert.deepEqual(ids(searchTracks(db, 'dont stop')), ['r2'])
  assert.deepEqual(searchArtists(db, 'КИНО', []).map(a => a.id), [])
})

test('comments and lyrics are searched, after the names', () => {
  const db = library()
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('c1', 'Quiet', 'Nobody', 'Night', null, '/m/q.mp3', 0, 'recorded live in Berlin')
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run('l1', 'Untitled', 'Someone', 'Demo', null, '/m/u.mp3', 50)
  db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)').run('l2', 'Berlin', 'Else', 'Cities', null, '/m/b.mp3', 0)
  setFileLyrics(db, 'l1', '[ar:Someone]\n[00:12.30]Мы ждём перемен\n[00:15.00]in Berlin tonight')
  assert.deepEqual(ids(searchTracks(db, 'ждем перемен')), ['l1'])
  assert.deepEqual(ids(searchTracks(db, 'berlin')), ['l2', 'c1', 'l1'])
  // The time stamps aren't words.
  assert.deepEqual(searchTracks(db, '00 12'), [])
  setFileLyrics(db, 'l1', '')
  assert.deepEqual(searchTracks(db, 'перемен'), [])
})

test('the index follows changes to the songs', () => {
  const db = library()
  db.prepare("UPDATE tracks SET title = 'Renamed Song', comment = 'note' WHERE id = 't2'").run()
  assert.deepEqual(ids(searchTracks(db, 'renamed')), ['t2'])
  assert.deepEqual(ids(searchTracks(db, 'note')), ['t2'])
  assert.deepEqual(ids(searchTracks(db, 'gold')), [])
  db.prepare("DELETE FROM tracks WHERE id = 't2'").run()
  assert.deepEqual(searchTracks(db, 'renamed'), [])
  // A streamed song that becomes a file is then in the library.
  db.prepare("UPDATE tracks SET file_path = '/m/fame2.flac' WHERE id = 't4'").run()
  assert.deepEqual(ids(searchTracks(db, 'fame fools hallex')), ['t1', 't4'])
})

test('every song found is returned, unless a limit is asked for', () => {
  const db = library()
  const add = db.prepare('INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?, ?, NULL)')
  for (let i = 0; i < 120; i++) add.run(`m${i}`, `Many ${i}`, 'Bulk', 'Lots', null, `/m/many${i}.mp3`, 0)
  assert.equal(searchTracks(db, 'many').length, 120)
  assert.equal(searchTracks(db, 'many', 10).length, 10)
})

test('albums match by their own name or artist', () => {
  const db = library()
  const match = wordsMatch('covers', ['album', 'album_artist', 'artist'])
  assert.deepEqual(db.prepare(`SELECT id FROM tracks WHERE ${match.sql}`).all(...match.params).map(r => r.id), ['t3'])
  const byLyrics = wordsMatch('Fools Gold', ['album', 'album_artist', 'artist'])
  assert.deepEqual(db.prepare(`SELECT id FROM tracks WHERE ${byLyrics.sql}`).all(...byLyrics.params), [])
})
