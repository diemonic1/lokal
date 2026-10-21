// Rebuilds test/fixtures: short MP3s (made with ffmpeg + LAME) with the kinds of tags found in a
// library, and expected.json: what Lokal's loudness measurement gives for each and the SHA-256 of
// each once its ReplayGain tags are written. Lokal for Android's tests check the same file
// (tools/sync-loudness-native.mjs copies it), so both apps are held to the same numbers and bytes.
//   node native/loudness/test/make-fixtures.mjs [ffmpeg]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const out = path.join(here, 'fixtures')
const ffmpeg = process.argv[2] || 'ffmpeg'
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-loudness-'))

function encode(name, source, args) {
  const file = path.join(tmp, name + '.raw.mp3')
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...source, '-c:a', 'libmp3lame', ...args, '-id3v2_version', '0', '-write_id3v1', '0', file])
  if (r.status !== 0) throw new Error(String(r.stderr))
  return fs.readFileSync(file)
}

const synchsafe = n => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f])
function frame(major, id, data) {
  const head = Buffer.alloc(10)
  head.write(id, 0, 'latin1')
  if (major === 4) synchsafe(data.length).copy(head, 4)
  else head.writeUInt32BE(data.length, 4)
  return Buffer.concat([head, data])
}
const latin = s => Buffer.concat([Buffer.from([0]), Buffer.from(s, 'latin1')])
const utf16 = s => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le')])
const txxx16 = (d, v) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(d, 'utf16le'), Buffer.from([0, 0, 0xff, 0xfe]), Buffer.from(v, 'utf16le')])
const txxx8 = (d, v) => Buffer.concat([Buffer.from([3]), Buffer.from(d, 'utf8'), Buffer.from([0]), Buffer.from(v, 'utf8')])
function tag(major, padding, ...frames) {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)])
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([major, 0, 0]), synchsafe(body.length), body])
}
const id3v1 = () => { const b = Buffer.alloc(128); b.write('TAGFixture', 0, 'latin1'); return b }

const sine = (rate, ch, hz, db, s) => ['-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=${rate}:duration=${s}`, '-af', `volume=${db}dB${ch === 2 ? ',pan=stereo|c0=c0|c1=c0' : ''}`, '-ar', String(rate), '-ac', String(ch)]
const noise = (rate, ch, color, amp, s) => ['-f', 'lavfi', '-i', `anoisesrc=color=${color}:sample_rate=${rate}:amplitude=${amp}:duration=${s}:seed=7`, '-ar', String(rate), '-ac', String(ch)]

const fixtures = {
  'sine-44100-stereo-cbr.mp3': () => encode('a', sine(44100, 2, 1000, -20, 6), ['-b:a', '128k']),
  'pink-48000-stereo-vbr-v24.mp3': () => Buffer.concat([tag(4, 0, frame(4, 'TIT2', Buffer.concat([Buffer.from([3]), Buffer.from('Розовый', 'utf8')])), frame(4, 'TXXX', txxx8('LOKAL_ADDED', '2026-10-19T12:34:56Z'))), encode('b', noise(48000, 2, 'pink', 0.5, 5), ['-q:a', '2'])]),
  'white-32000-mono-v23-padded.mp3': () => Buffer.concat([tag(3, 512, frame(3, 'TIT2', utf16('Шум')), frame(3, 'TPE1', latin('Fixture'))), encode('c', noise(32000, 1, 'white', 0.3, 4), ['-b:a', '96k'])]),
  'brown-22050-mono-id3v1.mp3': () => Buffer.concat([encode('d', noise(22050, 1, 'brown', 0.8, 4), ['-q:a', '4']), id3v1()]),
  'sine-8000-mono-mpeg25.mp3': () => encode('e', sine(8000, 1, 440, -12, 4), ['-b:a', '16k']),
  'square-44100-clipped-v23-rg.mp3': () => Buffer.concat([
    tag(3, 64, frame(3, 'TXXX', txxx16('replaygain_track_gain', '-9.99 dB')), frame(3, 'TIT2', utf16('Loud'))),
    encode('f', ['-f', 'lavfi', '-i', 'aevalsrc=0.99*sgn(sin(2*PI*220*t))|0.99*sgn(sin(2*PI*221*t)):s=44100:d=4'], ['-b:a', '192k']),
  ]),
  'silence-44100-stereo.mp3': () => encode('g', ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '3'], ['-b:a', '64k']),
}

fs.mkdirSync(out, { recursive: true })
const addon = require(path.join(root, 'electron', 'native', `loudness.${process.platform}-${process.arch}.node`))
const { writeTrackReplayGain } = require(path.join(root, 'electron', 'replayGainTag.js'))
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const expected = {}
for (const [name, make] of Object.entries(fixtures)) {
  const file = path.join(out, name)
  fs.writeFileSync(file, make())
  const r = await addon.measure(file, 1200)
  const entry = { ...r }
  if (r.status === 0) {
    const copy = path.join(tmp, name)
    fs.copyFileSync(file, copy)
    writeTrackReplayGain(copy, r)
    entry.taggedSha256 = sha(copy)
  }
  expected[name] = entry
  console.log(name, JSON.stringify(entry))
}
fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected, null, 2) + '\n')
fs.rmSync(tmp, { recursive: true, force: true })
