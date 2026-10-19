// The Lyrics Search tab (electron/lyrics/bulkSearch.js): lyrics are only taken
// a level up, kept in their own folder until Save, and written into the file
// the way "Insert into track" writes them.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { initDB, getDB } = require('../electron/ipc/db.js')
const repository = require('../electron/lyrics/repository.js')
const bulk = require('../electron/lyrics/bulkSearch.js')
const fileLyrics = require('../electron/lyrics/fileLyrics.js')

function silentMp3(frames = 40) {
  const frame = Buffer.alloc(417)
  frame.set([0xff, 0xfb, 0x90, 0x00])
  return Buffer.concat(Array.from({ length: frames }, () => frame))
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-lyrics-search-'))
  const previous = process.env.LOKAL_DATA_DIR
  process.env.LOKAL_DATA_DIR = path.join(dir, 'data')
  initDB()
  const db = getDB()
  t.after(() => {
    bulk.cancel()
    db.close()
    if (previous === undefined) delete process.env.LOKAL_DATA_DIR
    else process.env.LOKAL_DATA_DIR = previous
    fs.rmSync(dir, { recursive: true, force: true })
  })
  const file = path.join(dir, 'song.mp3')
  fs.writeFileSync(file, silentMp3())
  db.prepare("INSERT INTO tracks (id, file_hash, title, artist, album, duration, file_path, lyrics_kind) VALUES ('t1', 'h1', 'Song', 'Artist', 'Album', 30, ?, '')").run(file)
  return { db, dir, file }
}

const SYLLABLE = [
  '[00:01.00]<00:01.000>Hel<00:01.400>lo <00:01.800>there <00:02.300>my <00:02.600>friend<00:03.000>',
  '[00:03.00]<00:03.000>This <00:03.400>is <00:03.700>a <00:04.000>test <00:04.500>line<00:05.000>',
  '[00:05.00]<00:05.000>With <00:05.400>words <00:05.800>to <00:06.100>sing <00:06.600>along<00:07.000>',
].join('\n')

async function finished() {
  for (let i = 0; i < 200; i++) {
    const status = bulk.get(getDB()).progress.status
    if (status === 'done' || status === 'stopped') return status
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('the search never finished')
}

test('lyrics only go a level up', () => {
  assert.ok(bulk.isUpgrade('', 'plain'))
  assert.ok(bulk.isUpgrade('', 'instrumental'))
  assert.ok(bulk.isUpgrade('plain', 'sync'))
  assert.ok(bulk.isUpgrade('plain', 'syllable'))
  assert.ok(bulk.isUpgrade('sync', 'syllable'))
  assert.ok(!bulk.isUpgrade('plain', 'plain'))
  assert.ok(!bulk.isUpgrade('plain', 'instrumental'))
  assert.ok(!bulk.isUpgrade('sync', 'sync'))
  assert.ok(!bulk.isUpgrade('syllable', 'syllable'))
  assert.ok(!bulk.isUpgrade('instrumental', 'syllable'))
  assert.ok(!bulk.isUpgrade('unfound', 'plain'))
})

test('found lyrics are kept apart until Save writes the ticked ones', async (t) => {
  const { db, file } = fixture(t)
  t.mock.method(repository, 'lookup', async () => ({ result: repository.toResult('test', { raw: SYLLABLE }) }))

  bulk.start(db, { plain: true, sync: true })
  assert.equal(await finished(), 'done')
  const { items } = bulk.get(db)
  assert.equal(items.length, 1)
  assert.equal(items[0].fromKind, '')
  assert.equal(items[0].toKind, 'syllable')
  assert.equal(items[0].checked, false)
  // Nothing in the file or the lyrics cache yet.
  assert.equal((await fileLyrics.readFileLyrics(file)).text, '')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lyrics_cache').get().n, 0)

  // Check: the lines the panel shows, with their word timings.
  const preview = bulk.preview('t1')
  assert.equal(preview.sync, 'syllable')
  assert.equal(preview.lines[0].words[0].word, 'Hel')

  // Compare + Apply: edited, still syllable.
  const compare = await bulk.compare(db, 't1')
  assert.equal(compare.original, '')
  assert.ok(compare.syllable)
  const edited = bulk.edit('t1', compare.text.replace('Hel', 'Hal'))
  assert.equal(edited.ok, true)
  assert.equal(edited.toKind, 'syllable')
  assert.equal(bulk.preview('t1').lines[0].words[0].word, 'Hal')

  // Save writes nothing unticked.
  assert.equal((await bulk.save(db)).saved.length, 0)
  bulk.setChecked(['t1'], true)
  const saved = await bulk.save(db)
  assert.deepEqual(saved.saved.map(s => s.trackId), ['t1'])
  assert.equal(saved.saved[0].lyricsKind, 'syllable')
  assert.equal(saved.reset, true)

  const read = await fileLyrics.readFileLyrics(file)
  assert.ok(read.synced, 'the standard tags get LRC')
  assert.match(read.syllable, /Hal/)
  // Both lyrics frames, as insert_lyrics.py writes them, plus Lokal's word timings.
  const meta = await require('../electron/musicMetadata.js').parseFile(file, { duration: false, skipCovers: true })
  const ids = Object.values(meta.native).flat().map(tag => tag.id)
  assert.ok(ids.includes('USLT'), 'USLT')
  assert.ok(ids.includes('SYLT'), 'SYLT')
  assert.ok(ids.some(id => String(id).includes('LOKAL_LYRICS')), 'LOKAL_LYRICS')
  assert.equal(db.prepare("SELECT lyrics_kind FROM tracks WHERE id = 't1'").get().lyrics_kind, 'syllable')
  // The last one saved: the search starts over.
  assert.equal(bulk.get(db).progress.status, 'idle')
})

test('a stopped search carries on from the same file, and Cancel leaves the track alone', async (t) => {
  const { db, file } = fixture(t)
  let release
  const hold = new Promise(resolve => { release = resolve })
  t.mock.method(repository, 'lookup', async (_, options) => {
    await Promise.race([hold, new Promise(resolve => options.signal?.addEventListener('abort', resolve))])
    return { result: options.signal?.aborted ? null : repository.toResult('test', { raw: SYLLABLE }) }
  })

  bulk.start(db, {})
  await new Promise(resolve => setTimeout(resolve, 30))
  bulk.stop()
  assert.equal(await finished(), 'stopped')
  assert.equal(bulk.get(db).progress.done, 0, 'the song being looked up is looked up again')

  release()
  bulk.resume(db)
  assert.equal(await finished(), 'done')
  assert.equal(bulk.get(db).items.length, 1)

  bulk.cancel()
  assert.equal(bulk.get(db).progress.status, 'idle')
  assert.equal((await fileLyrics.readFileLyrics(file)).text, '')
})

test("the report's \"Add to the ignore list\" ignores the song and takes it out of the report", async (t) => {
  const { db, dir, file } = fixture(t)
  const second = path.join(dir, 'song2.mp3')
  fs.writeFileSync(second, silentMp3())
  db.prepare("INSERT INTO tracks (id, file_hash, title, artist, album, duration, file_path, lyrics_kind) VALUES ('t2', 'h2', 'Other', 'Artist', 'Album', 30, ?, '')").run(second)
  t.mock.method(repository, 'lookup', async () => ({ result: repository.toResult('test', { raw: SYLLABLE }) }))

  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  bulk.setChecked(['t1', 't2'], true)
  assert.equal(bulk.get(db).items.length, 2)

  const r = bulk.ignoreFromReport(db, 't1')
  assert.deepEqual(r, { ok: true, reset: false })
  assert.deepEqual(bulk.get(db).items.map(item => item.trackId), ['t2'])
  assert.deepEqual(bulk.ignoreGet(db).tracks.map(item => item.id), ['t1'])
  assert.equal(bulk.preview('t1'), null, 'its found lyrics are gone')
  assert.equal((await fileLyrics.readFileLyrics(file)).text, '', 'the file is left alone')
  assert.equal(bulk.ignoreFromReport(db, 't1').ok, false, 'not in the report any more')

  // The last one gone: the search starts over, and the next one skips the ignored song.
  assert.equal(bulk.ignoreFromReport(db, 't2').reset, true)
  assert.equal(bulk.get(db).progress.status, 'idle')
  bulk.ignoreRemove(db, { type: 'track', id: 't2' })
  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  assert.deepEqual(bulk.get(db).items.map(item => item.trackId), ['t2'])
})

test('a stopped search opens its report: what was found so far, with its source, can be saved', async (t) => {
  const { db, dir, file } = fixture(t)
  const second = path.join(dir, 'song2.mp3')
  fs.writeFileSync(second, silentMp3())
  db.prepare("INSERT INTO tracks (id, file_hash, title, artist, album, duration, file_path, lyrics_kind) VALUES ('t2', 'h2', 'Song 2', 'Artist', 'Album', 30, ?, '')").run(second)
  let release
  const hold = new Promise(resolve => { release = resolve })
  t.mock.method(repository, 'lookup', async (query, options) => {
    // The first song is found at once; the second waits until stopped.
    if (query.title === 'Song 2' && !options.signal?.aborted) await Promise.race([hold, new Promise(resolve => options.signal?.addEventListener('abort', resolve))])
    return { result: options.signal?.aborted ? null : repository.toResult('lrclib', { raw: SYLLABLE }) }
  })

  bulk.start(db, {})
  for (let i = 0; i < 200 && bulk.get(db).progress.done < 1; i++) await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(bulk.get(db).items, undefined, 'no report while searching')
  bulk.stop()
  assert.equal(await finished(), 'stopped')
  const { items } = bulk.get(db)
  assert.deepEqual(items.map(item => item.trackId), ['t1'])
  assert.equal(items[0].source, 'lrclib')

  bulk.setChecked(['t1'], true)
  const saved = await bulk.save(db)
  assert.deepEqual(saved.saved.map(s => s.trackId), ['t1'])
  assert.equal(saved.reset, false, 'the search is kept to carry on')
  assert.match((await fileLyrics.readFileLyrics(file)).syllable, /Hel/)
  assert.equal(bulk.get(db).progress.status, 'stopped')
  assert.deepEqual(bulk.get(db).items, [])

  release()
  bulk.resume(db)
  assert.equal(await finished(), 'done')
  assert.deepEqual(bulk.get(db).items.map(item => item.trackId), ['t2'])
})

test('lyrics no better than the file\'s are not offered', async (t) => {
  const { db, file } = fixture(t)
  fileLyrics.writeFileLyrics(file, '[00:01.00]Already synced lyrics in this file\n[00:03.00]With a second line of words')
  db.prepare("UPDATE tracks SET lyrics_kind = 'sync' WHERE id = 't1'").run()
  t.mock.method(repository, 'lookup', async () => ({ result: repository.toResult('test', { raw: '[00:01.00]Other synced lyrics found online\n[00:03.00]And another line of them' }) }))
  bulk.start(db, { sync: true })
  assert.equal(await finished(), 'done')
  assert.equal(bulk.get(db).items.length, 0)
})

test('ignored tracks and artists are skipped without a single lookup', async (t) => {
  const { db, dir } = fixture(t)
  const other = path.join(dir, 'other.mp3')
  fs.writeFileSync(other, silentMp3())
  db.prepare("INSERT INTO tracks (id, file_hash, title, artist, album, duration, file_path, lyrics_kind) VALUES ('t2', 'h2', 'Other', 'Band A, Band B', 'Album', 30, ?, '')").run(other)
  const asked = []
  t.mock.method(repository, 'lookup', async (query) => { asked.push(query.title); return { result: null } })

  bulk.ignoreAdd(db, { tracks: ['t1'], artists: ['Band B'] })
  const list = bulk.ignoreGet(db)
  assert.deepEqual(list.tracks.map(item => item.id), ['t1'])
  assert.deepEqual(list.artists.map(item => item.name), ['Band B'])
  // Kept in the settings table, which the app export carries whole.
  assert.match(db.prepare('SELECT value FROM settings WHERE key = ?').get(bulk.IGNORE_KEY).value, /Band B/)

  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  assert.deepEqual(asked, [])

  bulk.ignoreRemove(db, { type: 'artist', name: 'band b' })
  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  assert.deepEqual(asked, ['Other'])
})

test('an instrumental answer marks only a track with no lyrics, once ticked and saved', async (t) => {
  const { db, file } = fixture(t)
  t.mock.method(repository, 'lookup', async () => ({ result: { type: 'instrumental', sync: 'none', lines: [], source: 'test', instrumental: true } }))
  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  const [item] = bulk.get(db).items
  assert.equal(item.fromKind, '')
  assert.equal(item.toKind, 'instrumental')
  assert.equal((await fileLyrics.readFileLyrics(file)).text, '')
  bulk.setChecked(['t1'], true)
  const saved = await bulk.save(db)
  assert.equal(saved.saved[0].lyricsKind, 'instrumental')
  assert.equal((await fileLyrics.readFileLyrics(file)).text, 'Instrumental track without lyrics')
})

test('Check: another source asked without caching, then put into the report', async (t) => {
  const { db, file } = fixture(t)
  const PLAIN = 'Plain words of this song, long enough to count as real lyrics here'
  t.mock.method(repository, 'lookup', async (_, options) => ({
    result: repository.toResult(options.only || 'first', { raw: options.only === 'other' ? SYLLABLE : PLAIN }),
    attempts: {},
  }))
  bulk.start(db, {})
  assert.equal(await finished(), 'done')
  assert.equal(bulk.get(db).items[0].toKind, 'plain')

  const other = await bulk.fromSource(db, 't1', 'other')
  assert.equal(other.kind, 'syllable')
  assert.equal(other.usable, true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lyrics_cache').get().n, 0)
  // Still the first answer until it's put into the report.
  assert.equal(bulk.get(db).items[0].toKind, 'plain')

  const used = await bulk.useSource(db, 't1', 'other')
  assert.equal(used.ok, true)
  const [item] = bulk.get(db).items
  assert.equal(item.toKind, 'syllable')
  assert.equal(item.source, 'other')
  assert.equal((await fileLyrics.readFileLyrics(file)).text, '', 'nothing written into the file yet')
})

test('"added in the last day" looks only at the tracks added since yesterday', async (t) => {
  const { db, dir } = fixture(t)
  const old = path.join(dir, 'old.mp3')
  fs.writeFileSync(old, silentMp3())
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 24 * 60 * 60
  db.prepare("INSERT INTO tracks (id, file_hash, title, artist, album, duration, file_path, lyrics_kind, added_at) VALUES ('t2', 'h2', 'Old', 'Artist', 'Album', 30, ?, '', ?)").run(old, twoDaysAgo)
  const asked = []
  t.mock.method(repository, 'lookup', async (query) => { asked.push(query.title); return { result: null } })

  const { counts } = bulk.get(db)
  assert.equal(counts.none, 2)
  assert.equal(counts.recent.none, 1)

  bulk.start(db, {}, { recent: true })
  assert.equal(await finished(), 'done')
  assert.deepEqual(asked, ['Song'])

  db.prepare("UPDATE tracks SET added_at = ? WHERE id = 't1'").run(twoDaysAgo)
  bulk.cancel()
  assert.equal(bulk.start(db, {}, { recent: true }).ok, false)
})
