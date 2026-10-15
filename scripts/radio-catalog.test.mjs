import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { parseStreamTitle, sameSong, stationTrack, isStationTrack, lyricsTrackFor, stationSongTime } from '../src/radio/stations.js'
import { stationColumnLayout, stationColumnPreferences } from '../src/radio/stationColumns.js'
import { radioBufferSeconds } from '../src/store/radio.js'

const require = createRequire(import.meta.url)
const { parseCatalog } = require('../electron/radio/catalog.js')
const { fromAzuracast, fromRadioRecord, fromLautfm, fromJson, nowPlaying } = require('../electron/radio/nowPlaying.js')

const SAMPLE = JSON.stringify({
  version: 1,
  title: 'Мой каталог радиостанций',
  stations: [
    { title: 'Record Rap Hits', url: 'https://radiorecord.hostingradio.ru/rap96.aacp', genre: 'Рэп', description: 'http://direct.radiorecord.ru/station/rap', api: { type: 'radiorecord', station: 'rap' } },
    { title: 'Радио Эрмитаж', url: 'https://hermitage.hostingradio.ru/hermitage128.mp3', description: 'Классика' },
    { title: 'LoFi Radio', url: 'https://live.lofiradio.ru/lofi_mp3_128', description: 'LoFi Girl', icon: 'https://raw.githubusercontent.com/x/lofi.jpg' },
    { title: 'Rivendell', url: 'https://play.radiorivendell.com/radio/8000/radio.mp3', genre: 'DnD', api: { type: 'azuracast', url: 'https://play.radiorivendell.com/api/nowplaying/radio_rivendell' } },
  ],
}, null, 2)

test('a catalogue keeps its stations in order with only the fields it has', () => {
  const result = parseCatalog(SAMPLE)
  assert.equal(result.ok, true)
  const { catalog } = result
  assert.equal(catalog.title, 'Мой каталог радиостанций')
  assert.deepEqual(catalog.stations.map(s => s.title), ['Record Rap Hits', 'Радио Эрмитаж', 'LoFi Radio', 'Rivendell'])
  assert.equal(catalog.stations[1].genre, undefined)
  assert.equal(catalog.stations[1].icon, undefined)
  assert.equal(catalog.stations[1].api, undefined)
  assert.equal(catalog.stations[2].icon, 'https://raw.githubusercontent.com/x/lofi.jpg')
  assert.deepEqual(catalog.stations[0].api, { type: 'radiorecord', station: 'rap' })
  assert.equal(new Set(catalog.stations.map(s => s.id)).size, 4)
})

test('a byte order mark and unknown fields are fine', () => {
  const result = parseCatalog('﻿{"stations":[{"title":"A","url":"http://a.example/s","color":"red"}]}')
  assert.equal(result.ok, true)
  assert.equal(result.catalog.stations[0].color, undefined)
})

test('broken JSON says where', () => {
  const result = parseCatalog('{\n  "stations": [\n    { "title": "A", "url": "http://a" }\n    { "title": "B" }\n  ]\n}')
  assert.equal(result.ok, false)
  const [error] = result.errors
  assert.equal(error.code, 'json-syntax')
  assert.equal(error.line, 4)
  assert.ok(error.excerpt.includes('"B"'))
})

test('a station without title or url is reported with its path, all at once', () => {
  const result = parseCatalog(JSON.stringify({ stations: [
    { title: 'Fine', url: 'https://ok.example/s' },
    { url: 'https://no-title.example/s' },
    { title: 'No url' },
    { title: 'Bad url', url: 'ftp://x' },
    { title: 'Bad api', url: 'https://x.example', api: { type: 'shoutcast' } },
    { title: 'Api without url', url: 'https://x.example', api: { type: 'azuracast' } },
  ] }))
  assert.equal(result.ok, false)
  const found = result.errors.map(e => `${e.path}:${e.code}`)
  assert.deepEqual(found, [
    'stations[1].title:required-missing',
    'stations[2].url:required-missing',
    'stations[3].url:bad-url',
    'stations[4].api.type:api-type-unknown',
    'stations[5].api.url:required-missing',
  ])
})

test('no stations list is an error', () => {
  assert.equal(parseCatalog('{"title":"x"}').errors[0].code, 'required-missing')
  assert.equal(parseCatalog('[]').errors[0].code, 'root-not-object')
  assert.equal(parseCatalog('').errors[0].code, 'empty')
})

test('StreamTitle splits at the first " - "', () => {
  assert.deepEqual(parseStreamTitle("Averil 'Tincolindo' White - Villain's Theme"), { artist: "Averil 'Tincolindo' White", title: "Villain's Theme" })
  assert.deepEqual(parseStreamTitle('MIYAGI/ANDY PANDA - Atlant'), { artist: 'MIYAGI/ANDY PANDA', title: 'Atlant' })
  assert.deepEqual(parseStreamTitle('Reggy Van Oers - Shunned (Original Mix)'), { artist: 'Reggy Van Oers', title: 'Shunned (Original Mix)' })
  assert.deepEqual(parseStreamTitle('Jingle', 'LoFi Radio'), { artist: 'LoFi Radio', title: 'Jingle' })
  assert.equal(parseStreamTitle('   '), null)
})

test('the same song despite case, accents and mix suffixes', () => {
  assert.equal(sameSong({ artist: 'Reggy Van Oers', title: 'Shunned (Original Mix)' }, { artist: 'reggy van oers', title: 'Shunned' }), true)
  assert.equal(sameSong({ artist: 'A', title: 'One' }, { artist: 'A', title: 'Two' }), false)
})

test('a station entry plays as a station and shows its icon first', () => {
  const { catalog } = parseCatalog(SAMPLE)
  const lofi = stationTrack(catalog.stations[2], catalog.title)
  assert.equal(isStationTrack(lofi), true)
  assert.equal(lofi.artwork_url, 'https://raw.githubusercontent.com/x/lofi.jpg')
  assert.equal(stationTrack(catalog.stations[1]).artwork_url, null)
  // Before a song is known, the lyrics views get the station as it is.
  assert.equal(lyricsTrackFor(lofi), lofi)
  const playing = { ...lofi, title: 'Song', artist: 'Band', song_key: 'k', song_clock_base: 100, song_duration: 180 }
  const lyrics = lyricsTrackFor(playing)
  assert.equal(lyrics.id, 'station-song:k')
  assert.equal(lyrics.duration, 180)
  assert.equal(lyrics.file_path, '')
  assert.equal(stationSongTime(playing, 112.5), 12.5)
  assert.equal(stationSongTime({ title: 'x' }, 5), null)
})

test('the buffer setting is 0-10 seconds, 3 by default', () => {
  assert.equal(radioBufferSeconds(undefined), 3)
  assert.equal(radioBufferSeconds(''), 3)
  assert.equal(radioBufferSeconds('0'), 0)
  assert.equal(radioBufferSeconds('15'), 10)
  assert.equal(radioBufferSeconds('-2'), 0)
})

test('station columns: title always, others while they fit, in the saved order', () => {
  const columns = stationColumnPreferences({ order: ['title', 'number'], stream: true })
  const wide = stationColumnLayout(80, columns)
  assert.deepEqual(wide.order, ['title', 'genre', 'comment', 'nowPlaying', 'stream', 'number'])
  const narrow = stationColumnLayout(20, columns)
  assert.deepEqual(narrow.order, ['title', 'number'])
  assert.equal(stationColumnLayout(80, stationColumnPreferences({ genre: false })).genre, false)
})

test('AzuraCast now playing', () => {
  const data = { station: { shortcode: 'radio_rivendell' }, now_playing: { duration: 176, elapsed: 145, song: { text: "Averil 'Tincolindo' White - Villain's Theme", artist: "Averil 'Tincolindo' White", title: "Villain's Theme", album: '', lyrics: '', art: 'https://play.radiorivendell.com/static/uploads/album_art.1648581841.jpg' } } }
  assert.deepEqual(fromAzuracast(data, {}), { artist: "Averil 'Tincolindo' White", title: "Villain's Theme", cover: 'https://play.radiorivendell.com/static/uploads/album_art.1648581841.jpg', duration: 176, elapsed: 145 })
  const all = [{ station: { shortcode: 'a', id: 1 }, now_playing: { song: { text: 'X - One' } } }, { station: { shortcode: 'b', id: 2 }, now_playing: { song: { text: 'Y - Two' } } }]
  assert.deepEqual(fromAzuracast(all, { station: 'b' }), { artist: 'Y', title: 'Two' })
})

test('Radio Record now playing by station id', () => {
  const data = { result: [{ id: 511, track: { artist: 'MIYAGI', song: 'Atlant', image600: 'https://is5-ssl.mzstatic.com/600x600bb.jpg', image100: 'https://x/100.jpg' } }] }
  assert.deepEqual(fromRadioRecord(data, 511), { artist: 'MIYAGI', title: 'Atlant', cover: 'https://is5-ssl.mzstatic.com/600x600bb.jpg' })
  assert.equal(fromRadioRecord(data, 1), null)
})

test('Radio Record looks a prefix up once', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    const body = url.endsWith('/stations/')
      ? { result: { stations: [{ id: 511, prefix: 'rap' }] } }
      : { result: [{ id: 511, track: { artist: 'A', song: 'B' } }] }
    return { ok: true, json: async () => body }
  }
  assert.deepEqual(await nowPlaying({ type: 'radiorecord', station: 'rap' }, { fetchImpl }), { artist: 'A', title: 'B' })
  await nowPlaying({ type: 'radiorecord', station: 'rap' }, { fetchImpl })
  assert.equal(calls.filter(url => url.endsWith('/stations/')).length, 1)
})

test('laut.fm now playing', () => {
  const song = fromLautfm({ title: 'Shunned (Original Mix)', album: 'EDM - Heartbeat', length: 401, genre: 'Techno', releaseyear: 2019, artist: { name: 'Reggy Van Oers' }, started_at: '2026-10-15 20:37:02 +0200' })
  assert.equal(song.artist, 'Reggy Van Oers')
  assert.equal(song.album, 'EDM - Heartbeat')
  assert.equal(song.year, 2019)
  assert.equal(song.duration, 401)
  assert.ok(Number.isFinite(song.elapsed))
})

test('any JSON API by field paths', () => {
  const data = { now: { track: { a: 'Band', t: 'Song', img: 'https://x/c.jpg' } }, list: [{ text: 'Other - Thing' }] }
  assert.deepEqual(fromJson(data, { artist: 'now.track.a', title: 'now.track.t', cover: 'now.track.img' }), { artist: 'Band', title: 'Song', cover: 'https://x/c.jpg' })
  assert.deepEqual(fromJson(data, { text: 'list[0].text' }), { artist: 'Other', title: 'Thing' })
})

test('a station API that fails is just nothing', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({}) })
  assert.equal(await nowPlaying({ type: 'azuracast', url: 'https://x.example/api' }, { fetchImpl }), null)
  assert.equal(await nowPlaying({ type: 'unknown' }, { fetchImpl }), null)
})

test('the Online Radio tab comes just before Videos, also in a saved order', async () => {
  const { tabOrder } = await import('../src/appTabs.js')
  assert.deepEqual(tabOrder('').slice(0, 7), ['/', '/library', '/albums', '/artists', '/genres', '/stations', '/videos'])
  const saved = tabOrder(JSON.stringify(['/', '/library', '/artists', '/genres', '/albums', '/videos', '|', '/recap', '/quality', '/lyrics-analysis']))
  assert.equal(saved.indexOf('/stations'), saved.indexOf('/videos') - 1)
})
