import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isWordsJson, parseWordsJson, wordsJsonToEnhanced } = require('../electron/lyrics/wordsJson.js')
const { parseAny } = require('../electron/lyrics/detect.js')

const words = (...list) => JSON.stringify({ words: list.map(([text, start, end]) => ({ text, start, end, score: -1 })) })

test('a flat word list splits into lines at capitals, pauses and sentence ends', () => {
  const raw = words(
    ['Банки', 8.54, 8.96], ['хотят', 9.12, 10.9], ['долг', 11.2, 12.86],
    ['Оооо...', 12.98, 13.88],
    ['ещё', 16.0, 16.3], ['раз', 16.4, 16.8],
    ['потом', 19.0, 19.4],
  )
  assert.ok(isWordsJson(raw))
  const lines = parseWordsJson(raw)
  assert.deepEqual(lines.map(l => l.text), ['Банки хотят долг', 'Оооо...', 'ещё раз', 'потом'])
  assert.equal(lines[0].time, 8.54)
  assert.equal(lines[0].end, 12.86)
  assert.deepEqual(lines[0].words.map(w => [w.word, w.time, w.end]), [['Банки', 8.54, 8.96], ['хотят', 9.12, 10.9], ['долг', 11.2, 12.86]])
})

test('WhisperX segments are the lines', () => {
  const raw = JSON.stringify({ segments: [
    { start: 1, end: 2, text: 'one two', words: [{ word: 'one', start: 1, end: 1.4 }, { word: 'Two', start: 1.5, end: 2 }] },
    { start: 3, end: 4, text: 'three', words: [{ word: 'three', start: 3, end: 4 }] },
  ] })
  assert.deepEqual(parseWordsJson(raw).map(l => l.text), ['one Two', 'three'])
})

test('enhanced LRC for the tag editor, and the shared parser reads it', () => {
  const raw = words(['Hello', 1, 1.5], ['world', 1.6, 2.2])
  assert.equal(wordsJsonToEnhanced(raw), '[00:01.000]<00:01.000>Hello <00:01.600>world<00:02.200>')
  const parsed = parseAny(raw)
  assert.equal(parsed.lines.length, 1)
  assert.equal(parsed.lines[0].words.length, 2)
})

test('other JSON is not word-timed lyrics', () => {
  assert.equal(isWordsJson('{"lyrics":"[00:01.00]hi"}'), false)
  assert.equal(isWordsJson('{"words":[]}'), false)
  assert.equal(isWordsJson('not json'), false)
  assert.equal(parseAny('{"lyrics":"[00:01.00]hi"}').lines[0].text, 'hi')
})
