// A library folder's order is its songs' track numbers, biggest on top
// (Library sorted by track number, newest first). See electron/folderTracks.js.

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripVertical } from 'lucide-react'

/**
 * The numbers the rows get while being reordered, top to bottom, biggest
 * first. The folder keeps the numbers it has (they needn't start at 1); with
 * repeated or missing ones it's renumbered down from max(biggest, count).
 */
export function draftNumbers(tracks) {
  const count = tracks.length
  const numbers = tracks.map(track => Math.floor(Number(track?.track_num))).filter(n => n > 0)
  if (numbers.length === count && new Set(numbers).size === count) return [...numbers].sort((a, b) => b - a)
  const top = Math.max(count, ...numbers, 0)
  return Array.from({ length: count }, (_, index) => top - index)
}

/**
 * A song picked up (held still for a few seconds in the list) follows the
 * pointer until it's let go: over a folder in the sidebar ([data-folder-drop])
 * `onDrop(track, folder)` moves it there; anywhere else, or Escape, drops it
 * back. -> { start(track, { x, y }), ghost } (render `ghost` on the page).
 */
export function useFolderGrab(onDrop) {
  const [grabbed, setGrabbed] = useState(null) // { track, x, y }
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop

  const start = useCallback((track, at) => setGrabbed({ track, x: at?.x ?? 0, y: at?.y ?? 0 }), [])

  useEffect(() => {
    if (!grabbed) return undefined
    const track = grabbed.track
    document.body.classList.add('lokal-folder-dragging')
    const move = event => setGrabbed(prev => (prev ? { ...prev, x: event.clientX, y: event.clientY } : prev))
    const finish = (event, cancelled = false) => {
      setGrabbed(null)
      if (cancelled) return
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-folder-drop]')
      const folder = target?.getAttribute('data-folder-drop')
      if (folder) dropRef.current?.(track, folder)
    }
    const up = event => finish(event)
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); finish(event, true) } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
    return () => {
      document.body.classList.remove('lokal-folder-dragging')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('keydown', key, true)
    }
  }, [grabbed?.track]) // eslint-disable-line react-hooks/exhaustive-deps

  const ghost = grabbed ? createPortal(
    <div className="pointer-events-none fixed z-[300] flex max-w-xs items-center gap-2 rounded-lg border border-accent/50 bg-elevated/95 px-3 py-1.5 text-xs text-white shadow-2xl backdrop-blur"
      style={{ left: grabbed.x + 14, top: grabbed.y + 10 }}>
      <GripVertical size={13} className="flex-shrink-0 text-accent" />
      <span className="truncate">{grabbed.track.artist ? `${grabbed.track.artist} - ` : ''}{grabbed.track.title}</span>
    </div>,
    document.body,
  ) : null

  return { start, ghost }
}
