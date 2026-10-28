// Word-timed lyrics as JSON, the way speech aligners write them (WhisperX and
// the like) -> Lokal lyrics lines with word timings:
//
//   { "words": [{ "start": 8.54, "end": 8.96, "text": "Банки" }, ...] }
//   { "segments": [{ "start", "end", "text", "words": [{ "word", "start", "end" }] }] }
//   { "word_segments": [...] }   or just the array of words
//
// Segments are the lines. A flat list of words has no lines, so it's split
// where a line most likely starts: a capital letter, a pause of
// LINE_GAP_S or more, or after . ! ? … -- and never past MAX_WORDS words.

const { unit, joinUnits, round3 } = require('./model')

const LINE_GAP_S = 1.2
const MAX_WORDS = 14

const num = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value))

/** One word from any of the shapes above, or null without a start time or text. */
function readWord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text ?? raw.word ?? raw.w ?? '').replace(/\s+/g, ' ').trim()
  const start = num(raw.start ?? raw.startTime ?? raw.time ?? raw.begin)
  if (!text || start == null) return null
  const end = num(raw.end ?? raw.endTime)
  return { text, start, end: end != null && end >= start ? end : null }
}

function wordsOf(list) {
  return (Array.isArray(list) ? list : []).map(readWord).filter(Boolean).sort((a, b) => a.start - b.start)
}

/** The document's lines, as lists of words; null when it isn't word-timed JSON. */
function groups(doc) {
  if (Array.isArray(doc)) {
    const words = wordsOf(doc)
    return words.length ? splitLines(words) : null
  }
  if (!doc || typeof doc !== 'object') return null
  if (Array.isArray(doc.segments) && doc.segments.some(s => Array.isArray(s?.words))) {
    const lines = doc.segments.map(s => wordsOf(s?.words)).filter(words => words.length)
    return lines.length ? lines : null
  }
  for (const key of ['words', 'word_segments']) {
    const words = wordsOf(doc[key])
    if (words.length) return splitLines(words)
  }
  return null
}

function splitLines(words) {
  const lines = []
  let line = []
  for (const word of words) {
    const prev = line[line.length - 1]
    const gap = prev ? word.start - (prev.end ?? prev.start) : 0
    const breakHere = prev && (
      /^\p{Lu}/u.test(word.text)
      || gap >= LINE_GAP_S
      || /[.!?…]["»”']?$/.test(prev.text)
      || line.length >= MAX_WORDS
    )
    if (breakHere) { lines.push(line); line = [] }
    line.push(word)
  }
  if (line.length) lines.push(line)
  return lines
}

function parse(text) {
  const value = String(text || '').replace(/^﻿/, '').trim()
  if (!value.startsWith('{') && !value.startsWith('[')) return null
  try { return JSON.parse(value) } catch { return null }
}

/** True when the text is word-timed JSON this module reads. */
function isWordsJson(text) {
  return !!groups(parse(text))
}

/** Word-timed JSON -> lines ({ time, end, text, words }) like parseEnhancedLRC's; [] when it isn't one. */
function parseWordsJson(text) {
  const lines = groups(parse(text))
  if (!lines) return []
  return lines.map((words) => {
    const units = words.map((word, i) => {
      const next = words[i + 1]
      const end = word.end ?? (next ? next.start : word.start + 0.5)
      return unit(word.text, word.start, end, i < words.length - 1)
    })
    return {
      time: round3(units[0].time),
      end: units[units.length - 1].end,
      endStated: true,
      text: joinUnits(units),
      words: units,
    }
  })
}

function clock(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000))
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

/** Word-timed JSON -> enhanced LRC (what the tag editor's By Syllable tab edits); '' when it isn't one. */
function wordsJsonToEnhanced(text) {
  return parseWordsJson(text).map((line) => {
    let out = `[${clock(line.time)}]`
    for (const w of line.words) out += `<${clock(w.time)}>${w.word}${w.space ? ' ' : ''}`
    const last = line.words[line.words.length - 1]
    if (last.end != null) out += `<${clock(last.end)}>`
    return out
  }).join('\n')
}

module.exports = { isWordsJson, parseWordsJson, wordsJsonToEnhanced }
