import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')
const playlists = require('../electron/playlistFiles.js')

// A music folder with three songs in the library, and an empty database.
function fixture(t, settings = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-playlists-'))
  const music = path.join(dir, 'Music')
  fs.mkdirSync(path.join(music, 'Artist', 'Album'), { recursive: true })
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = path.join(dir, 'data')
  initDB()
  const db = getDB()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('music_folder', music)
  for (const [key, value] of Object.entries(settings)) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  const ids = ['One', 'Two', 'Three'].map((title, index) => {
    const file = path.join(music, 'Artist', 'Album', `0${index + 1} ${title}.mp3`)
    fs.writeFileSync(file, '')
    db.prepare('INSERT INTO tracks (id, file_path, file_hash, title, artist, duration) VALUES (?, ?, ?, ?, ?, ?)').run(`t${index + 1}`, file, `h${index + 1}`, title, 'Artist', 200 + index)
    return `t${index + 1}`
  })
  t.after(() => {
    playlists.stop()
    db.close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const folder = path.join(music, 'Playlists')
  return { db, ids, folder, read: name => fs.readFileSync(path.join(folder, name), 'utf8') }
}

const songs = text => text.split('\n').filter(line => line && !line.startsWith('#'))

test('a playlist file: name, id, cover and songs relative to the file, read back the same', () => {
  const text = playlists.serialize({ name: 'Road trip', id: 'pl-1', cover: 'data:image/jpeg;base64,AAAA', extra: [], entries: [{ path: '../A/01 x.mp3', duration: 203, label: 'A - x' }] })
  assert.equal(text, '#EXTM3U\n#PLAYLIST:Road trip\n#LOKAL-ID:pl-1\n#LOKAL-COVER:data:image/jpeg;base64,AAAA\n#EXTINF:203,A - x\n../A/01 x.mp3\n')
  const back = playlists.parse(`﻿${text.replace(/\n/g, '\r\n')}`)
  assert.equal(back.name, 'Road trip')
  assert.equal(back.id, 'pl-1')
  assert.equal(back.cover, 'data:image/jpeg;base64,AAAA')
  assert.deepEqual(back.entries, [{ path: '../A/01 x.mp3', duration: 203, label: 'A - x', trackId: null }])
  const idText = '#EXTM3U\n#PLAYLIST:X\n#LOKAL-ID:pl-2\n#LOKAL-TRACK:7f3a9c2e1b04d8aa\n#EXTINF:1,A - y\n../A/y.mp3\n'
  const withId = playlists.parse(idText)
  assert.equal(withId.entries[0].trackId, '7f3a9c2e1b04d8aa')
  assert.equal(playlists.serialize(withId), idText)
  assert.equal(playlists.entryPath(path.join('M', 'Playlists'), path.join('M', 'A', '01 x.mp3')), '../A/01 x.mp3')
})

test('new songs go to the start in their order, a song already there moves; no favourites file before a like', t => {
  const { db, ids, folder, read } = fixture(t)
  playlists.sync({ force: true })
  assert.ok(!fs.existsSync(path.join(folder, 'Любимые.m3u8')))
  const playlist = playlists.create('Mix / 1', { trackIds: [ids[2]] })
  assert.equal(playlist.file_name, 'Mix _ 1.m3u8')
  playlists.addTracks(playlist.id, [ids[0], ids[1]])
  assert.deepEqual(songs(read('Mix _ 1.m3u8')), ['../Artist/Album/01 One.mp3', '../Artist/Album/02 Two.mp3', '../Artist/Album/03 Three.mp3'])
  playlists.addTracks(playlist.id, [ids[2]])
  assert.deepEqual(songs(read('Mix _ 1.m3u8')), ['../Artist/Album/03 Three.mp3', '../Artist/Album/01 One.mp3', '../Artist/Album/02 Two.mp3'])
  const rows = db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlist.id).map(row => row.track_id)
  assert.deepEqual(rows, [ids[2], ids[0], ids[1]])
})

test('songs go to the end when set so; reorder, remove, rename and delete write the file', t => {
  const { db, ids, folder, read } = fixture(t, { playlists_add_position: 'end' })
  const playlist = playlists.create('Old')
  playlists.addTracks(playlist.id, [ids[0]])
  playlists.addTracks(playlist.id, [ids[1], ids[2]])
  assert.deepEqual(songs(read('Old.m3u8')).map(line => line.slice(-7)), ['One.mp3', 'Two.mp3', 'ree.mp3'])
  playlists.reorder(playlist.id, [ids[2], ids[0], ids[1]])
  assert.deepEqual(songs(read('Old.m3u8')).map(line => line.slice(-7)), ['ree.mp3', 'One.mp3', 'Two.mp3'])
  playlists.removeTracks(playlist.id, [ids[0]])
  assert.equal(songs(read('Old.m3u8')).length, 2)
  playlists.rename(playlist.id, 'New')
  assert.ok(!fs.existsSync(path.join(folder, 'Old.m3u8')))
  assert.match(read('New.m3u8'), /#PLAYLIST:New\n#LOKAL-ID:/)
  assert.equal(db.prepare('SELECT name FROM playlists WHERE id = ?').get(playlist.id).name, 'New')
  playlists.remove(playlist.id)
  assert.ok(!fs.existsSync(path.join(folder, 'New.m3u8')))
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE id = ?').get(playlist.id).n, 0)
})

test('a line whose song is missing is kept when the file is written again', t => {
  const { ids, folder, read } = fixture(t)
  fs.mkdirSync(folder, { recursive: true })
  fs.writeFileSync(path.join(folder, 'Synced.m3u8'), '#EXTM3U\n#PLAYLIST:Synced\n#LOKAL-ID:pl-x\n#EXTINF:100,Someone - Not here yet\n../Elsewhere/song.mp3\n')
  playlists.sync({ force: true })
  playlists.addTracks('pl-x', [ids[0]])
  assert.deepEqual(songs(read('Synced.m3u8')), ['../Artist/Album/01 One.mp3', '../Elsewhere/song.mp3'])
})

test('likes are the favourites file; turned off, nothing is made and nothing can be liked', t => {
  const { db, ids, read } = fixture(t)
  assert.equal(playlists.setFavorite(ids[1], true).liked, true)
  assert.equal(playlists.setFavorite(ids[0], true).liked, true)
  assert.deepEqual(songs(read('Любимые.m3u8')).map(line => line.slice(-7)), ['One.mp3', 'Two.mp3'])
  assert.match(read('Любимые.m3u8'), /#LOKAL-KIND:favorites/)
  const liked = db.prepare("SELECT track_id FROM user_likes WHERE user_id = 'guest' ORDER BY liked_at DESC").all().map(row => row.track_id)
  assert.deepEqual(liked, [ids[0], ids[1]])
  playlists.setFavorite(ids[0], false)
  assert.equal(songs(read('Любимые.m3u8')).length, 1)
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('playlists_favorites', '0')").run()
  playlists.settingsChanged()
  assert.equal(playlists.setFavorite(ids[2], true).liked, false)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_likes').get().n, 0)
})

test('playlists and likes from before the files are written out once', t => {
  const { db, ids, read } = fixture(t)
  db.prepare("INSERT INTO playlists (id, name, user_id) VALUES ('pl-old', 'Before', 'guest')").run()
  db.prepare("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('pl-old', ?, 1), ('pl-old', ?, 2)").run(ids[1], ids[0])
  db.prepare("INSERT INTO user_likes (user_id, track_id, liked_at) VALUES ('guest', ?, 10), ('guest', ?, 20)").run(ids[0], ids[2])
  playlists.sync({ force: true })
  assert.deepEqual(songs(read('Before.m3u8')).map(line => line.slice(-7)), ['Two.mp3', 'One.mp3'])
  assert.deepEqual(songs(read('Любимые.m3u8')).map(line => line.slice(-7)), ['ree.mp3', 'One.mp3'])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM playlists WHERE id = 'pl-old'").get().n, 0)
})

test('a song moved to another folder and retagged is still found by its own id', t => {
  const { db, ids, folder, read } = fixture(t)
  db.prepare("UPDATE tracks SET lokal_id = 'aaaaaaaaaaaaaaaa' WHERE id = ?").run(ids[0])
  const playlist = playlists.create('Moves', { trackIds: [ids[0], ids[1]] })
  assert.ok(read('Moves.m3u8').includes('#LOKAL-TRACK:aaaaaaaaaaaaaaaa\n#EXTINF:200,Artist - One\n../Artist/Album/01 One.mp3\n'))
  // Moved and retagged: the library has it at a new path with new tags, the file still has the old line.
  const moved = path.join(path.dirname(folder), 'Elsewhere', 'renamed.mp3')
  db.prepare("UPDATE tracks SET file_path = ?, title = 'Другое', artist = 'Someone' WHERE id = ?").run(moved, ids[0])
  playlists.sync({ force: true })
  assert.deepEqual(db.prepare('SELECT track_id FROM playlist_tracks WHERE playlist_id = ? ORDER BY position').all(playlist.id).map(row => row.track_id), [ids[0], ids[1]])
  // Written again (any change): the line gets the song's current path.
  playlists.reorder(playlist.id, [ids[1], ids[0]])
  assert.deepEqual(songs(read('Moves.m3u8')), ['../Artist/Album/02 Two.mp3', '../Elsewhere/renamed.mp3'])
  playlists.removeTracks(playlist.id, [ids[0]])
  assert.deepEqual(songs(read('Moves.m3u8')), ['../Artist/Album/02 Two.mp3'])
})
