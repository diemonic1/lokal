// The song id (electron/trackId.js) and how it's written (electron/replayGainTag.js writeLokalId)
// against native/loudness/test/fixtures/expected.json. Lokal for Android's TrackIdTest checks the
// same file: both apps must make the same id for a file and write it to the same bytes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(root, 'native', 'loudness', 'test', 'fixtures')
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'expected.json'), 'utf8'))
const ids = require('../electron/trackId.js')
const tags = require('../electron/replayGainTag.js')
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const GAIN = { lufsTenths: -143, peakMicro: 987654 }

function copyOf(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-id-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, name)
  fs.copyFileSync(path.join(fixtures, name), file)
  return file
}

test('the id formula: "lokal|<seconds>|<sha1 of the audio sample>"', () => {
  const sample = Buffer.from('audio')
  const inner = crypto.createHash('sha1').update(sample).digest('hex')
  const want = crypto.createHash('sha1').update(`lokal|1792615071|${inner}`).digest('hex').slice(0, 16)
  assert.equal(ids.computeId(1792615071, sample), want)
  assert.match(want, ids.ID_PATTERN)
})

for (const [name, want] of Object.entries(expected)) {
  test(`${name}: the same id and bytes as expected.json`, t => {
    const file = copyOf(t, name)
    const read = tags.readLokalTags(file)
    assert.equal(ids.computeId(want.lokalAdded, ids.audioSample(file, read.audioStart, read.size)), want.lokalId)
    tags.writeLokalId(file, want.lokalId)
    assert.equal(sha(file), want.idSha256, 'id written')
    tags.writeLokalId(file, want.lokalId)
    assert.equal(sha(file), want.idSha256, 'id written twice')
    assert.equal(tags.readLokalTags(file).id, want.lokalId)
    // Tags changed after: the audio sample, so a fresh id, would be the same.
    const after = tags.readLokalTags(file)
    assert.equal(ids.computeId(want.lokalAdded, ids.audioSample(file, after.audioStart, after.size)), want.lokalId)
    tags.writeTrackReplayGain(file, GAIN)
    assert.equal(sha(file), want.idThenGainSha256, 'id, then ReplayGain')
    const other = copyOf(t, name)
    tags.writeTrackReplayGain(other, GAIN)
    tags.writeLokalId(other, want.lokalId)
    assert.equal(sha(other), want.gainThenIdSha256, 'ReplayGain, then id')
  })
}

test('a tag with room: id and ReplayGain come out the same in either order', () => {
  const want = expected['white-32000-mono-v23-padded.mp3']
  assert.equal(want.idThenGainSha256, want.gainThenIdSha256)
})

test('a scan stamps a file with LOKAL_ADDED once, and keeps an id that is there', t => {
  const name = 'pink-48000-stereo-vbr-v24.mp3'
  const file = copyOf(t, name)
  assert.equal(ids.stampFile(file), expected[name].lokalId)
  assert.equal(sha(file), expected[name].idSha256)
  assert.equal(ids.stampFile(file), expected[name].lokalId)
  assert.equal(sha(file), expected[name].idSha256)
  // No date added yet: no id (the date is stamped first).
  assert.equal(ids.stampFile(copyOf(t, 'sine-44100-stereo-cbr.mp3')), null)
})
