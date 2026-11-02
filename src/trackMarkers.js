// A song's time markers (Edit Track; the file's LOKAL_MARKERS tag, see
// electron/trackMarkers.js): one a line, like synced lyrics --
// "[mm:ss.xx] caption" -- jumped between from the player bar.

// [mm:ss], [mm:ss.xx] or [h:mm:ss.xx] at a line's start, then the caption.
const LINE = /^\[(?:(\d+):)?(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/

/** The text's markers, [{ time (seconds), label }], by time; lines without a stamp are left out. */
export function parseMarkers(text) {
  const markers = []
  for (const line of String(text || '').split(/\r\n?|\n/)) {
    const match = LINE.exec(line.trim())
    if (!match) continue
    const [, h, m, s, fraction, label] = match
    const time = Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + (fraction ? Number(`0.${fraction}`) : 0)
    markers.push({ time, label: label.trim() })
  }
  return markers.sort((a, b) => a.time - b.time)
}

/** True when the text has a line that isn't a marker (a typo in a stamp). */
export function hasStrayLines(text) {
  return String(text || '').split(/\r\n?|\n/).some(line => line.trim() && !LINE.test(line.trim()))
}

/** The marker playing at `position`: the last one at or before it, or -1. */
export function markerAt(markers, position) {
  let at = -1
  for (let i = 0; i < markers.length; i++) {
    if (markers[i].time <= position + 0.05) at = i
    else break
  }
  return at
}
