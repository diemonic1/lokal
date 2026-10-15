import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ensureSearchIndex } = require('../electron/searchIndex.js')

// Inside a trigger SQLite swaps an INSERT OR IGNORE's policy for the outer
// statement's: an UPSERT on tracks (search results saved again) used to fail
// on the song's existing index row, and no result could be played.
test('saving an online song again (an UPSERT) works with the search index triggers', () => {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT UNIQUE NOT NULL, title TEXT, artist TEXT, album TEXT, album_artist TEXT, comment TEXT);`)
  ensureSearchIndex(db)
  const upsert = db.prepare(`INSERT INTO tracks (id, file_path, title, artist) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, artist = excluded.artist WHERE tracks.file_path LIKE 'ghost://%'`)
  upsert.run('yt-a', 'ghost://youtube/online/a', 'Song', 'Band')
  upsert.run('yt-a', 'ghost://youtube/online/a', 'Song (new title)', 'Band')
  db.prepare("INSERT INTO tracks (id, file_path, title, artist) VALUES ('t1', 'C:/m/a.mp3', 'Local', 'Band')").run()
  db.prepare("UPDATE tracks SET title = 'Local 2' WHERE id = 't1'").run()
  assert.equal(db.prepare("SELECT title FROM tracks WHERE id = 'yt-a'").get().title, 'Song (new title)')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM track_search_docs').get().n, 2)
})
