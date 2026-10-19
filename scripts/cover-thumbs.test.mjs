import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const { makeThumb, writeCover, THUMB_SIZE } = require('../electron/artwork/thumb.js')
const { fullCoverFor } = require('../electron/artwork/fullCover.js')
const { shrinkCovers, shrinkableCovers } = require('../electron/artwork/shrinkCovers.js')
const { artwork } = require('../electron/cacheAnalysis.js')

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-covers-'))
const picture = (width = 640, height = 480, format = 'jpeg') =>
  sharp({ create: { width, height, channels: 3, background: '#c83' } })[format]().toBuffer()

// An MP3 with an ID3v2.3 tag holding the picture (APIC), then a few silent frames.
function mp3With(pic, mime = 'image/jpeg') {
  const body = Buffer.concat([Buffer.from([0]), Buffer.from(mime + '\0', 'latin1'), Buffer.from([3]), Buffer.from('\0', 'latin1'), pic])
  const frameHeader = Buffer.alloc(10)
  frameHeader.write('APIC', 0, 'latin1')
  frameHeader.writeUInt32BE(body.length, 4)
  const frames = Buffer.concat([frameHeader, body])
  const size = frames.length
  const tagHeader = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f])
  const mpegFrame = Buffer.alloc(417)
  mpegFrame.set([0xff, 0xfb, 0x90, 0x64])
  return Buffer.concat([tagHeader, frames, ...Array.from({ length: 40 }, () => mpegFrame)])
}

function library() {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, file_path TEXT, artwork_path TEXT);
    CREATE TABLE artists (id TEXT PRIMARY KEY, image_path TEXT);
    CREATE TABLE playlists (id TEXT PRIMARY KEY, cover_path TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`)
  db.transaction = fn => (...args) => fn(...args)
  return db
}

test('a cover becomes a 150x150 WebP thumbnail', async () => {
  const thumb = await makeThumb(await picture(1200, 800))
  const meta = await sharp(thumb).metadata()
  assert.equal(meta.format, 'webp')
  assert.equal(meta.width, THUMB_SIZE)
  assert.equal(meta.height, THUMB_SIZE)
  assert.ok(thumb.length < 10 * 1024)
  assert.equal(await makeThumb(Buffer.from('not a picture')), null)
})

test('the scan writes <id>.webp into the covers cache and keeps one that is there', async () => {
  const dir = tempDir()
  const written = await writeCover(dir, 't-abc', await picture())
  assert.equal(written, path.join(dir, 't-abc.webp'))
  assert.equal((await sharp(fs.readFileSync(written)).metadata()).width, THUMB_SIZE)
  const stamp = fs.statSync(written).mtimeMs
  assert.equal(await writeCover(dir, 't-abc', await picture(300, 300)), written)
  assert.equal(fs.statSync(written).mtimeMs, stamp)
})

test('the full cover is read out of the song file; folder covers and online songs have none bigger', async () => {
  const storage = tempDir()
  fs.mkdirSync(path.join(storage, 'artwork'))
  const full = await picture(900, 900)
  const song = path.join(storage, 'song.mp3')
  fs.writeFileSync(song, mp3With(full))
  const thumb = path.join(storage, 'artwork', 't-1.webp')
  const cover = await fullCoverFor({ id: '1', file_path: song, artwork_path: thumb }, storage)
  assert.ok(cover)
  assert.equal(cover.mime, 'image/jpeg')
  assert.ok(cover.bytes.equals(full))
  assert.equal(await fullCoverFor({ id: '1', file_path: song, artwork_path: path.join(storage, 'cover.jpg') }, storage), null)
  assert.equal(await fullCoverFor({ id: '2', file_path: 'ghost://youtube/x', artwork_path: thumb }, storage), null)
})

test('full-size covers from before become thumbnails; hand-picked and online-only ones stay', async () => {
  const storage = tempDir()
  const dir = path.join(storage, 'artwork')
  fs.mkdirSync(dir)
  const full = await picture(1000, 1000)
  const withCover = path.join(storage, 'a.mp3')
  const withoutCover = path.join(storage, 'b.mp3')
  fs.writeFileSync(withCover, mp3With(full))
  fs.writeFileSync(withoutCover, mp3With(Buffer.alloc(0)).subarray(0, 10)) // no picture
  const big = name => { const p = path.join(dir, name); fs.writeFileSync(p, full); return p }
  const db = library()
  const add = db.prepare('INSERT INTO tracks (id, file_path, artwork_path) VALUES (?, ?, ?)')
  add.run('t-a', withCover, big('t-a.jpg'))
  add.run('t-a2', withCover, path.join(dir, 't-a.jpg')) // the same cover on a second row
  add.run('t-b', withoutCover, big('t-b.jpg'))
  add.run('t-online', 'ghost://youtube/x', big('t-online.jpg'))
  add.run('t-album', withCover, big('album-Some-Album.jpg'))
  db.prepare('INSERT INTO artists (id, image_path) VALUES (?, ?)').run('ar', big('artist-ar.jpg'))

  assert.deepEqual(shrinkableCovers(db, dir).map(c => path.basename(c.path)).sort(), ['t-a.jpg', 't-b.jpg'])
  const report = await artwork(dir, db)
  assert.equal(report.shrinkable.files, 2)
  const result = await shrinkCovers(db, dir)
  assert.equal(result.converted, 1)
  assert.equal(result.skipped, 1)
  assert.ok(result.freed > 0)
  assert.deepEqual(result.trackIds.sort(), ['t-a', 't-a2'])
  const row = id => db.prepare('SELECT artwork_path FROM tracks WHERE id = ?').get(id).artwork_path
  assert.equal(row('t-a'), path.join(dir, 't-a.webp'))
  assert.equal(row('t-a2'), path.join(dir, 't-a.webp'))
  assert.equal((await sharp(fs.readFileSync(row('t-a'))).metadata()).width, THUMB_SIZE)
  assert.equal(fs.existsSync(path.join(dir, 't-a.jpg')), false)
  for (const kept of ['t-b.jpg', 't-online.jpg', 'album-Some-Album.jpg', 'artist-ar.jpg']) assert.ok(fs.existsSync(path.join(dir, kept)), kept)
  assert.equal(row('t-online'), path.join(dir, 't-online.jpg'))

  // Cache Analysis tells the two kinds of song covers apart.
  const after = await artwork(dir, db)
  const ids = after.items.map(i => i.id)
  assert.ok(ids.includes('coverThumbs'))
  assert.ok(ids.includes('trackCovers'))
  // t-b's file has no picture: its cover is the only full copy, so it's no longer offered.
  assert.equal(after.shrinkable.files, 0)
  assert.equal((await shrinkCovers(db, dir)).converted, 0)
  assert.ok(fs.existsSync(path.join(dir, 't-b.jpg')))
})
