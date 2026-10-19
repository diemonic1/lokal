import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { pruneMissingTracks } = require('../electron/libraryPrune.js')

function library() {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, duration REAL, play_count INTEGER DEFAULT 0);
    CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE artist_track_links (artist_id TEXT, track_id TEXT, PRIMARY KEY (artist_id, track_id));
    CREATE TABLE user_likes (user_id TEXT, track_id TEXT, PRIMARY KEY (user_id, track_id));
    CREATE TABLE playlist_tracks (playlist_id TEXT, track_id TEXT, position INTEGER);`)
  db.transaction = fn => (...args) => fn(...args)
  return db
}

const root = path.resolve('/music')
const at = (...parts) => path.join(root, ...parts)

test('a file gone from the music folder leaves the library; a moved one keeps its likes and playlists', () => {
  const db = library()
  const add = db.prepare('INSERT INTO tracks (id, file_path, title, artist, duration, play_count) VALUES (?, ?, ?, ?, ?, ?)')
  add.run('old', at('Old', 'a.mp3'), 'Song', 'Band', 200, 5)
  add.run('new', at('New', 'a.mp3'), 'Song', 'Band', 200.5, 1)
  add.run('gone', at('Old', 'b.mp3'), 'Other', 'Band', 100, 0)
  add.run('kept', at('New', 'c.mp3'), 'Kept', 'Band', 100, 0)
  db.prepare("INSERT INTO artists VALUES ('a-gone', 'Gone')").run()
  db.prepare("INSERT INTO artist_track_links VALUES ('a-gone', 'gone')").run()
  db.prepare("INSERT INTO user_likes VALUES ('guest', 'old')").run()
  db.prepare("INSERT INTO playlist_tracks VALUES ('p', 'old', 0), ('p', 'gone', 1)").run()
  const onDisk = new Set([root, at('New', 'a.mp3'), at('New', 'c.mp3')])
  const result = pruneMissingTracks(db, root, [...onDisk].slice(1), { exists: file => onDisk.has(path.resolve(file)) })
  assert.deepEqual(result, { removed: 1, moved: 1 })
  assert.deepEqual(db.prepare('SELECT id FROM tracks ORDER BY id').all().map(row => row.id), ['kept', 'new'])
  assert.equal(db.prepare("SELECT play_count FROM tracks WHERE id = 'new'").get().play_count, 6)
  assert.deepEqual(db.prepare('SELECT track_id FROM user_likes').all().map(row => row.track_id), ['new'])
  assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks').all().map(row => row.track_id), ['new'])
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM artists').get().n, 0)
})

test('a moved file keeps the date it was first added', () => {
  const db = library()
  db.exec('ALTER TABLE tracks ADD COLUMN added_at INTEGER')
  const add = db.prepare('INSERT INTO tracks (id, file_path, title, artist, duration, added_at) VALUES (?, ?, ?, ?, ?, ?)')
  add.run('old', at('Old', 'a.mp3'), 'Song', 'Band', 200, 1000)
  add.run('new', at('New', 'a.mp3'), 'Song', 'Band', 200, 5000)
  const onDisk = new Set([root, at('New', 'a.mp3')])
  pruneMissingTracks(db, root, [at('New', 'a.mp3')], { exists: file => onDisk.has(path.resolve(file)) })
  assert.equal(db.prepare("SELECT added_at FROM tracks WHERE id = 'new'").get().added_at, 1000)
})

test('nothing is removed when the scan found no files (the folder or its drive is unavailable)', () => {
  const db = library()
  db.prepare('INSERT INTO tracks (id, file_path, title, artist) VALUES (?, ?, ?, ?)').run('x', at('a.mp3'), 'Song', 'Band')
  assert.deepEqual(pruneMissingTracks(db, root, [], { exists: () => false }), { removed: 0, moved: 0 })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tracks').get().n, 1)
})
