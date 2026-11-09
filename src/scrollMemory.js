// Where each step of the app's history was scrolled to. Every page scrolls in
// the same <main>; its position is noted per history entry (location.key) as
// it scrolls, and put back when that entry is returned to with Back / Forward
// (the arrow buttons, the mouse's side buttons). A page opened anew (a tab
// clicked, a link followed) starts at the top. See AnimatedRoutes in App.jsx.
//
// Coming back, the page may not be tall enough yet (its data still loading,
// a list that loads more as it's scrolled): the position is set again every
// frame until it holds, a list that loads in pages getting its next page each
// time it's scrolled to its end. Pages that are still switching what they show
// (the Library between two folders) hold the restore open with
// holdScrollRestore. Scrolling by hand (wheel, keys, a click) stops it.

import { markAutoScroll } from './menuScroll'

const positions = new Map()
const MAX_ENTRIES = 300
// The entry whose page is on screen and settled: scrolling is noted for it.
let recordingKey = null
let run = 0
const holds = new Set()

const RESTORE_MAX_MS = 6000
const SETTLE_MS = 450

/** The scrolling area every page is in. */
export function mainScroller() {
  return typeof document === 'undefined' ? null : document.querySelector('main.flex-1.overflow-y-auto')
}

/** Notes the position of the entry on screen (called on every scroll of <main>). */
export function noteScroll(top) {
  if (recordingKey == null) return
  positions.delete(recordingKey)
  positions.set(recordingKey, top)
  if (positions.size > MAX_ENTRIES) positions.delete(positions.keys().next().value)
}

/** Another entry is coming: its page isn't settled, nothing is noted until then. */
export function pauseRecording() {
  recordingKey = null
  run++
}

export function startRecording(key) {
  recordingKey = key
}

/** While on, a restore in progress keeps going (the page is still changing what it shows). */
export function holdScrollRestore(id, on) {
  if (on) holds.add(id)
  else holds.delete(id)
}

/** The top, for a page opened anew. */
export function scrollToTop(key) {
  const main = mainScroller()
  if (main) main.scrollTop = 0
  positions.delete(key)
  startRecording(key)
}

/** Back to where `key` was left (the top when it was never scrolled). */
export function restoreScroll(key) {
  const main = mainScroller()
  const target = positions.get(key) || 0
  const mine = ++run
  if (!main || target <= 0) {
    if (main) main.scrollTop = 0
    startRecording(key)
    return
  }
  let stopped = false
  const stop = () => { stopped = true }
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown']
  events.forEach(name => window.addEventListener(name, stop, { capture: true, passive: true }))
  const started = performance.now()
  let heldSince = null
  const finish = () => {
    events.forEach(name => window.removeEventListener(name, stop, { capture: true }))
    // Superseded by another navigation: that one records now.
    if (mine === run) startRecording(key)
  }
  const tick = () => {
    if (stopped || mine !== run) return finish()
    const now = performance.now()
    if (Math.abs(main.scrollTop - target) > 1) {
      markAutoScroll(main)
      main.scrollTop = target
    }
    if (Math.abs(main.scrollTop - target) <= 1 && !holds.size) {
      if (heldSince == null) heldSince = now
      else if (now - heldSince > SETTLE_MS) return finish()
    } else heldSince = null
    if (now - started > RESTORE_MAX_MS) return finish()
    requestAnimationFrame(tick)
  }
  tick()
}

// How deep each entry is in the history, to tell whether Back has somewhere
// to go (the MemoryRouter doesn't say): 0 for the entry the app opened on.
const depths = new Map()
let currentKey = null

/** Called on every navigation (AnimatedRoutes), before anything else. */
export function noteEntry(key, type, previousKey) {
  if (!depths.has(key) || type !== 'POP') {
    const before = previousKey != null ? (depths.get(previousKey) || 0) : -1
    depths.set(key, type === 'REPLACE' ? Math.max(0, before) : before + 1)
  }
  currentKey = key
}

/** Back one step when there is one; else to `fallback` (a page opened first, with nothing before it). */
export function goBack(navigate, fallback) {
  if ((depths.get(currentKey) || 0) > 0) navigate(-1)
  else navigate(fallback)
}
