// Lokal's own loudness measurement (native/loudness) and the ReplayGain tags it writes
// (electron/replayGainTag.js) against native/loudness/test/fixtures/expected.json. Lokal for
// Android's tests check the same file: a song must measure and tag the same on both.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { normalizedMultiplier } from '../src/audio/replayGain.mjs'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(root, 'native', 'loudness', 'test', 'fixtures')
const expected = JSON.parse(fs.readFileSync(path.join(fixtures, 'expected.json'), 'utf8'))
const tag = require('../electron/replayGainTag.js')
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-rg-'))

let addon = null
try { addon = require(path.join(root, 'electron', 'native', `loudness.${process.platform}-${process.arch}.node`)) } catch {}

// Text from integers: no float formatting.
assert.equal(tag.gainText(-143), '-3.70 dB')
assert.equal(tag.gainText(-212), '+3.20 dB')
assert.equal(tag.gainText(-180), '+0.00 dB')
assert.equal(tag.gainText(20), '-20.00 dB')
assert.equal(tag.peakText(987654), '0.987654')
assert.equal(tag.peakText(1000000), '1.000000')
assert.equal(tag.peakText(42), '0.000042')

for (const [name, want] of Object.entries(expected)) {
  if (addon) {
    const got = await addon.measure(path.join(fixtures, name), 1200)
    for (const k of ['status', 'lufsTenths', 'peakMicro', 'sampleRate', 'channels', 'frames']) assert.equal(got[k], want[k], `${name}: ${k}`)
  }
  if (!want.taggedSha256) continue
  const copy = path.join(tmp, name)
  fs.copyFileSync(path.join(fixtures, name), copy)
  tag.writeTrackReplayGain(copy, want)
  assert.equal(sha(copy), want.taggedSha256, `${name}: tagged bytes`)
  // Written again (both devices, one after the other): the same bytes.
  tag.writeTrackReplayGain(copy, want)
  assert.equal(sha(copy), want.taggedSha256, `${name}: tagged twice`)
  const rg = tag.readTrackReplayGain(copy)
  assert.equal(rg.trackGainDb, (-180 - want.lufsTenths) / 10, `${name}: gain read back`)
  assert.equal(rg.trackPeak, want.peakMicro / 1e6, `${name}: peak read back`)
}
fs.rmSync(tmp, { recursive: true, force: true })

// A song plays as loud from its written tags as from the measurement they came from.
for (const [lufsTenths, peakMicro, target] of [[-143, 987654, -14], [-250, 200000, -14], [-60, 1000000, -11], [-300, 500000, -19]]) {
  const measured = { lufs: lufsTenths / 10, peakDb: 20 * Math.log10(peakMicro / 1e6) }
  const tags = { trackGainDb: Number.parseFloat(tag.gainText(lufsTenths)), trackPeak: Number.parseFloat(tag.peakText(peakMicro)) }
  const a = normalizedMultiplier({ tags: null, mode: 'track', measured, target })
  const b = normalizedMultiplier({ tags, mode: 'track', measured: null, target })
  assert.ok(Math.abs(a - b) < 1e-9, `${lufsTenths}: ${a} vs ${b}`)
}

console.log(addon ? 'Loudness measurement and ReplayGain tag tests passed' : 'ReplayGain tag tests passed (native loudness not built: measurement skipped)')
