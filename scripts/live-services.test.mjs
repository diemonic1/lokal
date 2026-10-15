// The online services Lokal depends on, asked for real (network needed): if
// one of them changes its API or goes away, a test here fails and says which.
//
//   lyrics      every lyrics source (Settings > Playback > Lyrics), translation
//   pictures    album / song covers and artist photos, artist bios, genres
//   listening   YouTube Music search and stream, SoundCloud, release dates
//
// A source that only works with the user's own key or tool (Spicy Lyrics key,
// yt-dlp) is skipped, with the reason, when that isn't there. Set
// LOKAL_SPICY_KEY or LOKAL_YTDLP to include it.

import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { PROVIDERS, identify } = require('../electron/lyrics/providers')
const { toResult } = require('../electron/lyrics/repository')

// A song every catalogue has, with lyrics and a known length.
const SONG = { title: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', duration: 369 }
const QUERY = { ...SONG, searchTitle: SONG.title, searchArtist: SONG.artist }
const TIMEOUT = { timeout: 60000 }

const provider = id => PROVIDERS.find(p => p.id === id)
async function lyricsFrom(id, ctx = {}) {
  const output = await provider(id).fetch(QUERY, ctx)
  return toResult(id, output, { title: SONG.title, artist: SONG.artist })
}

// A network hiccup (a source slow while every test file runs at once) gets
// one more try before the test counts as failed.
function liveTest(name, options, fn) {
  return test(name, { timeout: 60000, ...options }, async t => {
    try { await fn(t) } catch {
      await new Promise(resolve => setTimeout(resolve, 3000))
      await fn(t)
    }
  })
}

async function getStatus(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
  return { status: res.status, body: await res.text() }
}

describe('lyrics sources', () => {
  liveTest('BiniLyrics: Apple Music syllable timings', TIMEOUT, async () => {
    const hit = await identify(QUERY, {}).catch(() => null)
    const result = await lyricsFrom('binilyrics', { hit })
    assert.ok(result, 'no lyrics')
    assert.equal(result.sync, 'syllable')
    assert.ok(result.lines.length > 20)
  })

  liveTest('LyricsPlus: syllable timings on its mirrors', TIMEOUT, async () => {
    const result = await lyricsFrom('lyricsplus')
    assert.ok(result, 'no lyrics')
    assert.ok(['syllable', 'line'].includes(result.sync))
    assert.ok(result.lines.length > 20)
  })

  liveTest('LRCLIB: line-synced LRC', TIMEOUT, async () => {
    const result = await lyricsFrom('lrclib')
    assert.ok(result, 'no lyrics')
    assert.equal(result.sync, 'line')
    assert.ok(result.lines.length > 20)
  })

  liveTest('KuGou: line-synced lyrics', TIMEOUT, async () => {
    const result = await lyricsFrom('kugou')
    assert.ok(result, 'no lyrics')
    assert.equal(result.sync, 'line')
    assert.ok(result.lines.length > 20)
  })

  liveTest('lyrics.ovh: plain text', TIMEOUT, async () => {
    const result = await lyricsFrom('lyricsovh')
    assert.ok(result, 'no lyrics')
    assert.ok(result.lines.length > 10)
  })

  // BetterLyrics only answers songs it has cached without a key; the API is
  // up as long as it answers in its own shape (lyrics, or "API key required").
  for (const [name, url] of [['BetterLyrics', 'https://lyrics-api.boidu.dev/getLyrics'], ['BetterLyrics Portato', 'https://lyrics-api.boidu.dev/qq/getLyrics']]) {
    liveTest(`${name}: the API answers`, TIMEOUT, async () => {
      const { status, body } = await getStatus(`${url}?${new URLSearchParams({ s: SONG.title, a: SONG.artist, d: String(SONG.duration) })}`)
      assert.ok(status === 200 || (status === 401 && /API key required/i.test(body)), `HTTP ${status}: ${body.slice(0, 200)}`)
    })
  }

  // Unison is contributed by listeners: "not found" is a valid answer too.
  liveTest('Unison: the API answers', TIMEOUT, async () => {
    const { status, body } = await getStatus(`https://unison.boidu.dev/lyrics?${new URLSearchParams({ song: SONG.title, artist: SONG.artist })}`)
    const data = JSON.parse(body)
    assert.ok(status === 200 ? data.success === true : data.code === 'NOT_FOUND', `HTTP ${status}: ${body.slice(0, 200)}`)
  })

  liveTest('Spicy Lyrics (needs the user\'s key)', { ...TIMEOUT, skip: !process.env.LOKAL_SPICY_KEY && 'set LOKAL_SPICY_KEY to check it' }, async () => {
    const output = await provider('spicylyrics').fetch(QUERY, { spicyKey: process.env.LOKAL_SPICY_KEY })
    assert.ok(toResult('spicylyrics', output), 'no lyrics')
  })

  liveTest('Google Translate: lyrics translation', TIMEOUT, async () => {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    const result = await require('../electron/lyrics/translate').translate(db, 'live-test', [{ text: 'Привет, как дела?' }, { text: 'Я иду домой' }], 'en')
    assert.equal(result.status, 'translated')
    assert.equal(result.detectedLang, 'ru')
    assert.match(result.lines[1].text, /home/i)
  })
})

describe('pictures and metadata', () => {
  const resolveArtwork = require('../electron/discoveryArtwork').createArtworkResolver()

  liveTest('song, album and artist pictures (Deezer / iTunes)', TIMEOUT, async () => {
    const [song, album, artist] = await resolveArtwork([
      { type: 'track', title: SONG.title, artist: SONG.artist },
      { type: 'album', title: SONG.album, artist: SONG.artist },
      { type: 'artist', artist: SONG.artist },
    ])
    for (const [what, value] of [['song', song], ['album', album], ['artist', artist]]) assert.match(value.image, /^https:\/\//, `no ${what} picture`)
  })

  for (const source of ['theaudiodb', 'deezer', 'wikidata', 'musicbrainz', 'wikipedia']) {
    liveTest(`artist page from ${source}: photo and bio`, TIMEOUT, async () => {
      const search = () => require('../electron/ipc/artistMetadata').searchArtistMetadataCandidates(SONG.artist, { source })
      // MusicBrainz allows one request a second: a refusal right after the
      // sources before it is asked again once.
      let candidates = await search().catch(() => [])
      if (!candidates?.length) { await new Promise(resolve => setTimeout(resolve, 2500)); candidates = await search() }
      const match = (candidates || []).find(row => /daft punk/i.test(row.title || row.name || ''))
      assert.ok(match, `no artist found: ${JSON.stringify(candidates).slice(0, 200)}`)
      assert.ok(match.imageUrl || match.image, 'no photo')
    })
  }

  liveTest('TheAudioDB: song lookup', TIMEOUT, async () => {
    const tracks = await require('../electron/theAudioDb').searchTracks(SONG.artist, SONG.title)
    assert.ok(Array.isArray(tracks) && tracks.some(track => /get lucky/i.test(track.strTrack)))
  })

  liveTest('iTunes: a song\'s genre', TIMEOUT, async () => {
    assert.ok(await require('../electron/online/genres').itunesGenre(SONG.title, SONG.artist))
  })

  liveTest('Apple Music: the web player\'s token (artist imports)', TIMEOUT, async () => {
    assert.ok(await require('../electron/online/appleMusic').developerToken())
  })
})

describe('listening', () => {
  const youtube = require('../electron/online/youtube')

  liveTest('YouTube Music: song search', TIMEOUT, async () => {
    const found = await youtube.searchSongs(`${SONG.artist} ${SONG.title}`)
    const rows = Array.isArray(found) ? found : found?.results || []
    const hit = rows.find(row => /get lucky/i.test(row.title))
    assert.ok(hit, `no result: ${JSON.stringify(rows.slice(0, 2)).slice(0, 200)}`)
    assert.match(String(hit.videoId || hit.id), /^[\w-]{11}$/)
  })

  // The fast engine (no yt-dlp) talks to YouTube Music's own player API.
  liveTest('YouTube Music: the web client the fast engine copies', TIMEOUT, async () => {
    const { status, body } = await getStatus('https://music.youtube.com/', { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' } })
    assert.equal(status, 200)
    assert.match(body, /"INNERTUBE_CLIENT_VERSION":"[^"]+"/)
  })

  // yt-dlp: Lokal's own copy, or LOKAL_YTDLP.
  const ytdlp = [process.env.LOKAL_YTDLP, path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'lokal-music', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp')]
    .find(file => file && fs.existsSync(file))
  const noYtdlp = !ytdlp && 'yt-dlp is not installed (Search > Download installs it; or set LOKAL_YTDLP)'

  liveTest('YouTube: a song\'s audio stream (yt-dlp)', { timeout: 120000, skip: noYtdlp }, async () => {
    const stream = await youtube.resolveStream('5NV6Rdv1a3I', { ytdlp, cookieArgs: [] })
    assert.match(stream.url, /^https:\/\//)
    const res = await fetch(stream.url, { headers: { ...stream.headers, Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(20000) })
    assert.ok(res.status === 206 || res.status === 200, `HTTP ${res.status}`)
    await res.body?.cancel()
  })

  liveTest('SoundCloud: song search (yt-dlp)', { timeout: 120000, skip: noYtdlp }, async () => {
    const found = await require('../electron/online/soundcloud').searchTracks(`${SONG.artist} ${SONG.title}`, { ytdlp })
    const rows = Array.isArray(found) ? found : found?.results || []
    assert.ok(rows.length > 0)
  })

  liveTest('Deezer: an artist\'s releases with dates', TIMEOUT, async () => {
    const { albums } = await require('../electron/online/releaseDates').deezerReleases(SONG.artist)
    const album = albums.find(row => /random access memories/i.test(row.title))
    assert.ok(album, 'album not found')
    assert.match(String(album.release_date), /^\d{4}-\d{2}-\d{2}$/)
  })
})
