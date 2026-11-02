// The player bar's markers button: shown while the playing song has time
// markers (Edit Track; see ../trackMarkers.js). A click opens their list over
// it, an arrow pointing at the button; a marker jumps the song there. The one
// playing is marked, and the list stays open for the next jump.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { useTranslation } from '../i18n'
import { clock } from '../clock'
import { markerAt, parseMarkers } from '../trackMarkers'

const WIDTH = 660
const EDGE = 8

export default function TrackMarkersButton({ className = '' }) {
  const { t } = useTranslation()
  const text = usePlayerStore(s => s.currentTrack?.markers || '')
  const progress = usePlayerStore(s => s.progress)
  const markers = useMemo(() => parseMarkers(text), [text])
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState(null)
  const buttonRef = useRef(null)
  const listRef = useRef(null)
  const current = markerAt(markers, progress)

  // Another song (or one without markers): the list closes.
  useEffect(() => { setOpen(false) }, [text])

  // Above the button, kept on the screen; the arrow under the button's middle.
  useLayoutEffect(() => {
    if (!open) return undefined
    const measure = () => {
      const r = buttonRef.current?.getBoundingClientRect()
      if (!r) return
      const middle = r.left + r.width / 2
      const width = Math.min(WIDTH, window.innerWidth - EDGE * 2)
      const left = Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, middle - width / 2))
      setPlace({ left, width, bottom: window.innerHeight - r.top + 12, arrow: middle - left })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // A click anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return undefined
    const down = (event) => {
      if (buttonRef.current?.contains(event.target) || listRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const key = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  // Opened: the playing marker in view.
  useEffect(() => {
    if (!open || !place) return
    listRef.current?.querySelector('[data-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, place])

  if (!markers.length) return null
  const jump = (time) => usePlayerStore.getState().setProgressWithAudioUpdate(time)

  return (
    <>
      <button ref={buttonRef} type="button" onClick={() => setOpen(v => !v)}
        title={t('Time markers')} aria-label={t('Time markers')} aria-expanded={open}
        className={`transition-colors ${open ? 'text-accent' : 'text-text/90 hover:text-text'} ${className}`}>
        <Menu size={16} />
      </button>
      {createPortal(
        <AnimatePresence>
          {open && place && (
            <motion.div
              ref={listRef}
              data-keep-dialog
              role="menu"
              // React events go up through the portal to the player bar: the
              // wheel there sets the volume, a right click opens the song's menu.
              // Here the wheel scrolls the list, and neither reaches the bar.
              onWheel={(event) => event.stopPropagation()}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
              initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.15 }}
              className="fixed z-[200] rounded-xl border border-white/10 bg-elevated/95 shadow-[0_18px_48px_rgba(0,0,0,0.55)] backdrop-blur-xl"
              style={{ left: place.left, bottom: place.bottom, width: place.width, transformOrigin: `${place.arrow}px 100%`, WebkitAppRegion: 'no-drag' }}
            >
              <div className="flex items-center justify-between px-3.5 pb-1.5 pt-2.5">
                <span className="text-[10px] font-display uppercase tracking-widest text-muted">{t('Time markers')}</span>
                <span className="text-[10px] tabular-nums text-muted">{markers.length}</span>
              </div>
              <div className="max-h-[min(50vh,24rem)] overflow-y-auto px-1 pb-1">
                {markers.map((marker, index) => {
                  const playing = index === current
                  return (
                    <button key={`${marker.time}-${index}`} type="button" role="menuitem" data-current={playing}
                      onClick={() => jump(marker.time)}
                      title={marker.label ? `${clock(marker.time)} — ${marker.label}` : clock(marker.time)}
                      className={`flex w-full items-baseline gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${playing ? 'bg-accent/15 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white'}`}>
                      <span className={`w-14 flex-shrink-0 text-right font-mono text-[12px] tabular-nums ${playing ? 'text-accent' : 'text-muted'}`}>{clock(marker.time)}</span>
                      <span aria-hidden className="flex-shrink-0 text-muted/60">—</span>
                      <span className="min-w-0 flex-1 truncate">{marker.label || t('Untitled')}</span>
                    </button>
                  )
                })}
              </div>
              {/* The arrow: a triangle under the list's edge (never over its
                  text), pointing down at the button. */}
              <svg aria-hidden width="16" height="8" viewBox="0 0 16 8" className="pointer-events-none absolute top-full -mt-px -translate-x-1/2 text-elevated"
                style={{ left: place.arrow }}>
                <path d="M0 0 L8 8 L16 0 Z" fill="currentColor" fillOpacity="0.95" />
                <path d="M0 0.5 L8 8 L16 0.5" fill="none" stroke="rgba(255,255,255,0.1)" />
              </svg>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
