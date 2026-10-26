import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { toTag, fromMeta, touches } = require('../electron/trackExtras.js')

const metaWith = (id, ...values) => ({ native: { 'ID3v2.3': values.map(value => ({ id, value })) } })

test('the explicit mark and music video round-trip through the LOKAL_TRACK tag', () => {
  const json = toTag({ explicit: 1, clip_url: ' https://youtu.be/abc?si=x ', clip_start: 12.5, clip_end: null, clip_zoom: 27 })
  assert.deepEqual(fromMeta(metaWith('TXXX:LOKAL_TRACK', json)), { explicit: 1, clip_url: 'https://youtu.be/abc?si=x', clip_start: 12.5, clip_end: null, clip_zoom: 27, highlight_time: null })
})

test('the important moment goes into the tag on its own too', () => {
  const json = toTag({ explicit: 0, clip_url: '', highlight_time: 75.5 })
  assert.equal(fromMeta(metaWith('TXXX:LOKAL_TRACK', json)).highlight_time, 75.5)
  assert.equal(touches({ highlight_time: null }), true)
})

test('a song with neither has no tag', () => {
  assert.equal(toTag({ explicit: 0, clip_url: '  ' }), null)
  assert.equal(fromMeta({ native: {} }), null)
})

test('an ID3v2.3 reader splitting the tag at "/" still reads it', () => {
  const json = toTag({ clip_url: 'https://youtu.be/abc' })
  assert.equal(fromMeta(metaWith('TXXX:LOKAL_TRACK', ...json.split('/'))).clip_url, 'https://youtu.be/abc')
})

test('only edits of these fields touch the tag', () => {
  assert.equal(touches({ title: 'x' }), false)
  assert.equal(touches({ explicit: 0 }), true)
  assert.equal(touches({ clip_zoom: null }), true)
})
