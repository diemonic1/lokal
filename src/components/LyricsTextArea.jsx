// The tag editor's lyrics field: black, 14 px, the words white and the time
// stamps ([mm:ss.xx] and <mm:ss.xxx>) grey. A textarea can't colour parts of
// its text, so it's drawn see-through over a copy that is coloured: same font,
// padding and scroll, and the same scrollbar room on both.
// Lines never wrap (they scroll sideways), so each row starts with its own
// time stamp; beside each one with a stamp, a play button (shown on hover)
// plays the song from there (onPlayLine); the row it would play is lit
// faintly while the button is pointed at.
// While the song plays (playhead, seconds), two red marks follow it: a bar
// beside the line being sung and a short underline under its syllable (its
// <mm:ss.xxx> piece; monospace, so placed by character).

import React, { useMemo, useRef, useState } from 'react'
import { Play } from 'lucide-react'

const STAMP = /(\[[^\]\n]*\]|<[^>\n]*>)/g
const FIRST_TIME = /[[<](\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?[\]>]/
// One row's height (px): the play buttons line up with the text rows by it.
const ROW = 22
const TEXT = 'm-0 py-2 pl-1 pr-3 font-mono text-[14px] leading-[22px] whitespace-pre'
const GUTTER = { scrollbarGutter: 'stable' }

function highlight(value) {
  return String(value || '').split(STAMP).map((part, i) => (
    i % 2 ? <span key={i} className="text-[#8a8a8a]">{part}</span> : part
  ))
}

/** A line's first time stamp, in seconds, or null. */
function lineTime(line) {
  const m = FIRST_TIME.exec(line)
  if (!m) return null
  const fraction = m[3] ? Number(m[3]) / 10 ** m[3].length : 0
  return Number(m[1]) * 60 + Number(m[2]) + fraction
}

const STAMP_AT = /[[<](\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?[\]>]/g
const seconds = (m) => Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 10 ** m[3].length : 0)

/**
 * Each line's start and its syllables: { row, start, syllables: [{ time, col, len }] }
 * -- col/len in characters, the text after a <stamp> up to the next stamp.
 */
function timedLines(value) {
  const out = []
  String(value || '').split('\n').forEach((line, row) => {
    const stamps = [...line.matchAll(STAMP_AT)]
    if (!stamps.length) return
    const syllables = []
    stamps.forEach((m, i) => {
      if (m[0][0] !== '<') return
      const col = m.index + m[0].length
      const end = i + 1 < stamps.length ? stamps[i + 1].index : line.length
      const len = line.slice(col, end).trimEnd().length
      if (len) syllables.push({ time: seconds(m), col, len })
    })
    out.push({ row, start: seconds(stamps[0]), syllables })
  })
  return out
}

/** Where the playhead is: { row, syllable } (syllable may be null), or null. */
function playheadAt(lines, time) {
  if (time == null || !Number.isFinite(time)) return null
  let line = null
  for (const l of lines) if (l.start <= time && (!line || l.start >= line.start)) line = l
  if (!line) return null
  let syllable = null
  for (const s of line.syllables) if (s.time <= time) syllable = s
  return { row: line.row, syllable }
}

export default function LyricsTextArea({ value, onChange, placeholder, onPlayLine, playLabel = '', playhead = null }) {
  const copyRef = useRef(null)
  const gutterRef = useRef(null)
  const rowsRef = useRef(null)
  const marksRef = useRef(null)
  const timed = useMemo(() => timedLines(value), [value])
  const at = playheadAt(timed, playhead)
  // The row whose play button is pointed at (lit under the text), or null.
  const [hoverRow, setHoverRow] = useState(null)
  const syncScroll = (event) => {
    const { scrollTop, scrollLeft } = event.currentTarget
    if (copyRef.current) { copyRef.current.scrollTop = scrollTop; copyRef.current.scrollLeft = scrollLeft }
    for (const layer of [gutterRef.current, rowsRef.current]) if (layer) layer.style.transform = `translateY(${-scrollTop}px)`
    if (marksRef.current) marksRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`
  }
  const lines = String(value || '').split('\n')
  return (
    <div className="relative flex min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-border bg-black focus-within:border-accent/50">
      {onPlayLine && (
        <div className="relative w-7 flex-shrink-0 overflow-hidden">
          <div ref={gutterRef} className="absolute inset-x-0 top-0 pt-2">
            {/* The line being sung: a red bar at its left. */}
            {at && <div aria-hidden="true" className="pointer-events-none absolute left-0 w-[3px] rounded-r bg-red-500" style={{ top: 8 + at.row * ROW, height: ROW }} />}
            {lines.map((line, i) => {
              const time = lineTime(line)
              return (
                <div key={i} className={`flex items-center justify-center ${hoverRow === i ? 'bg-white/[0.06]' : ''}`} style={{ height: ROW }}>
                  {time != null && (
                    <button type="button" onClick={() => onPlayLine(time)} title={playLabel} aria-label={playLabel}
                      onMouseEnter={() => setHoverRow(i)} onMouseLeave={() => setHoverRow(null)} onFocus={() => setHoverRow(i)} onBlur={() => setHoverRow(null)}
                      className="flex h-5 w-5 items-center justify-center rounded text-white opacity-0 transition-opacity hover:bg-white/10 hover:opacity-100 focus-visible:opacity-100">
                      <Play size={11} fill="currentColor" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="relative min-w-0 flex-1">
        {/* The pointed-at row, lit under the text (scrolled with it). */}
        <div ref={rowsRef} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 pt-2">
          {hoverRow != null && <div className="bg-white/[0.06]" style={{ height: ROW, marginTop: hoverRow * ROW }} />}
        </div>
        {/* The syllable being sung: a short red underline (scrolled both ways with the text). */}
        <div ref={marksRef} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 font-mono text-[14px]">
          {at?.syllable && (
            <div className="absolute h-[2px] rounded-full bg-red-500"
              style={{ top: 8 + at.row * ROW + ROW - 3, left: `calc(4px + ${at.syllable.col}ch)`, width: `${at.syllable.len}ch` }} />
          )}
        </div>
        {/* Room at the bottom (pb-8) for the textarea's sideways scrollbar,
            so the copy can scroll as far down as the textarea does. */}
        <pre ref={copyRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden text-white ${TEXT} pb-8`} style={GUTTER}>
          {highlight(value)}
          {/* A last empty line still takes its height, as in the textarea. */}
          {'\n'}
        </pre>
        <textarea
          value={value}
          onChange={onChange}
          onScroll={syncScroll}
          spellCheck={false}
          wrap="off"
          placeholder={placeholder}
          className={`absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent caret-white outline-none placeholder:text-[#8a8a8a] selection:bg-accent/40 ${TEXT}`}
          style={GUTTER}
        />
      </div>
    </div>
  )
}
