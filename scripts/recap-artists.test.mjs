import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

const require = createRequire(import.meta.url)
const { buildRecap, recapTracks } = require('../electron/ipc/recaps.js')

// Bong & Restless Monkey: only ever together. Apashe: also on his own (a
// library song not played this month), so Apashe & Vasiu are two artists.
function listening() {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, genre TEXT, genres TEXT,
    energy REAL, danceability REAL, valence REAL, acousticness REAL, instrumentalness REAL, tempo REAL);
    CREATE TABLE play_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL, seconds_played INTEGER DEFAULT 0, played_at INTEGER);
    CREATE TABLE user_settings (user_id TEXT, key TEXT, value TEXT, PRIMARY KEY (user_id, key));
    CREATE TABLE artists (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE artist_track_links (artist_id TEXT NOT NULL, track_id TEXT NOT NULL, PRIMARY KEY (artist_id, track_id));`)
  const tracks = [
    ['duo', 'Bong & Restless Monkey', ['bong', 'restless']],
    ['feat', 'Apashe & Vasiu', ['apashe', 'vasiu']],
    ['solo', 'Apashe', ['apashe']],
    ['other', 'Zed', ['zed']],
  ]
  const names = { bong: 'Bong', restless: 'Restless Monkey', apashe: 'Apashe', vasiu: 'Vasiu', zed: 'Zed' }
  for (const [id, name] of Object.entries(names)) db.prepare('INSERT INTO artists (id, name) VALUES (?, ?)').run(id, name)
  for (const [id, artist, links] of tracks) {
    db.prepare('INSERT INTO tracks (id, file_path, title, artist, album) VALUES (?, ?, ?, ?, ?)').run(id, `/music/${id}.flac`, id, artist, '')
    for (const link of links) db.prepare('INSERT INTO artist_track_links (artist_id, track_id) VALUES (?, ?)').run(link, id)
  }
  const at = Math.floor(Date.UTC(2025, 2, 10, 12) / 1000)
  const plays = ['duo', 'duo', 'feat', 'feat', 'other', 'other']
  for (const [i, id] of plays.entries()) db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, ?)').run('guest', id, 200, at + i * 300)
  return db
}

const march = { scope: 'month', year: 2025, month: 3, tz: 'UTC' }

test('artists credited together are split, unless they are only ever together', () => {
  const recap = buildRecap(listening(), 'guest', march)
  assert.deepEqual(recap.topArtists.map(item => [item.artist, item.plays, item.seconds]), [
    ['Apashe', 2, 400], ['Bong, Restless Monkey', 2, 400], ['Vasiu', 2, 400], ['Zed', 2, 400],
  ])
  assert.equal(recap.uniqueArtists, 4)
  assert.deepEqual(recap.topTracks.find(track => track.id === 'feat').recapArtists, ['Apashe', 'Vasiu'])
})

test('artists are ranked by the time listened, not by plays', () => {
  const db = listening()
  const at = Math.floor(Date.UTC(2025, 2, 20, 12) / 1000)
  // Zed: one more play, but shorter ones; Apashe: fewer plays, more minutes.
  for (const [i, [id, seconds]] of [['other', 40], ['other', 40], ['solo', 900]].entries()) {
    db.prepare('INSERT INTO play_history (user_id, track_id, seconds_played, played_at) VALUES (?, ?, ?, ?)').run('guest', id, seconds, at + i * 1000)
  }
  const top = buildRecap(db, 'guest', march).topArtists.map(item => [item.artist, item.plays, item.seconds])
  assert.deepEqual(top.slice(0, 3), [['Apashe', 3, 1300], ['Zed', 4, 480], ['Bong, Restless Monkey', 2, 400]])
})

test("a play's genres: its main genre and its list, each part once, whatever the case", () => {
  const db = listening()
  db.prepare("UPDATE tracks SET genre = 'Dubstep', genres = 'dubstep, Drum & Bass / Электроника; Music' WHERE id = 'duo'").run()
  db.prepare("UPDATE tracks SET genre = 'электроника' WHERE id = 'other'").run()
  const recap = buildRecap(db, 'guest', march)
  assert.deepEqual(recap.topGenres, [{ genre: 'Электроника', plays: 4 }, { genre: 'Drum & Bass', plays: 2 }, { genre: 'Dubstep', plays: 2 }])
  assert.deepEqual(recapTracks(db, 'guest', { ...march, genre: 'ЭЛЕКТРОНИКА' }).tracks.map(track => track.id).sort(), ['duo', 'other'])
})

test("an artist's songs are found by any of a track's artists, or by the group kept together", () => {
  const db = listening()
  assert.deepEqual(recapTracks(db, 'guest', { ...march, artist: 'Vasiu' }).tracks.map(track => track.id), ['feat'])
  assert.deepEqual(recapTracks(db, 'guest', { ...march, artist: 'Bong, Restless Monkey' }).tracks.map(track => track.id), ['duo'])
})

test("a play of a file no longer in the library still counts, as the history line names it, but isn't replayed", () => {
  const db = listening()
  db.exec(`CREATE TABLE history_gone_tracks (id TEXT PRIMARY KEY, file_path TEXT, title TEXT, artist TEXT, album TEXT, album_artist TEXT, genre TEXT, duration REAL);
    CREATE TABLE history_gone_plays (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, track_id TEXT NOT NULL, seconds_played INTEGER DEFAULT 0, session_id TEXT, played_at INTEGER NOT NULL, device TEXT);`)
  db.prepare("INSERT INTO history_gone_tracks VALUES ('gone:old/zed.mp3', 'S:/Music/old/zed.mp3', 'Old', 'Zed', NULL, NULL, 'Rock', 200)").run()
  const at = Math.floor(Date.UTC(2025, 2, 11, 12) / 1000)
  db.prepare("INSERT INTO history_gone_plays (user_id, track_id, seconds_played, played_at) VALUES ('guest', 'gone:old/zed.mp3', 300, ?)").run(at)
  const recap = buildRecap(db, 'guest', march)
  assert.equal(recap.totalPlays, 7)
  assert.equal(recap.uniqueTracks, 4)
  assert.deepEqual(recap.topArtists.find(item => item.artist === 'Zed'), { artist: 'Zed', plays: 3, seconds: 700 })
  assert.deepEqual(recap.topGenres, [{ genre: 'Rock', plays: 1 }])
  assert.equal(recap.topTracks.find(track => track.id === 'gone:old/zed.mp3').missing, 1)
  assert.ok(!recap.replayQueue.some(track => track.gone))
  assert.equal(buildRecap(db, 'guest', { ...march, sources: 'streamed' }).totalPlays, 0)
})
