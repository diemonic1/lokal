import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic2, Music, Search, Languages, RotateCcw, Check, ChevronDown, Loader2, FileDown, Ban, ALargeSmall, ScanSearch } from 'lucide-react'
import { useSideLyricsScale, sideLyricsPercent, setSideLyricsPercent, SIDE_LYRICS_PERCENT } from '../sidePanelPrefs'
import ContextMenu, { useContextMenu } from './ContextMenu'
import Modal from './Modal'
import LyricsSearchDrawer from './LyricsSearchDrawer'
import LyricBreakDots from './LyricBreakDots'
import { api } from '../api'
import { useLyricSubline } from '../lyrics/useLyricSubline'
import { announceLyricsChanged, announceLyricsFileChanged } from '../lyricLine'
import { announceTrackChanged } from '../trackChanged'
import { usePlayerStore } from '../store/player'
import { isStationTrack, lyricsTrackFor, stationPlainLyrics, stationSongTime } from '../radio/stations'
import { useTranslation } from '../i18n'
import { markAutoScroll } from '../menuScroll'
import { cacheLyrics, hasCachedLyrics, peekLyrics } from '../lyrics/lyricsCache'
import { clearLyricsPreview, showLyricsPreview, useLyricsPreviewFor } from '../lyricsPreview'
import {
  canGrow, growLetters, unitProgress, unitLift, activeRows, focusRow, stillSinging, lineEndOf, groupUnits, withOutroBreak,
} from '../lyrics/timing'

// ---------------------------------------------------------------------------
// Apple Music-style lyrics.
//
// Everything that moves every frame (the sweep across each syllable, the lift
// of the word being sung, the swell and glow of a held note, the interlude
// dots) is written straight to the DOM from one requestAnimationFrame loop, for
// only the lines actually being sung. React renders the list and re-renders
// only when the focused line changes.
// ---------------------------------------------------------------------------

const BROWSE_IDLE_MS = 3200
const FOCUS_LEAD_S = 0.3 // the panel starts moving to a line slightly before it lands
const SCROLL_MS = 560
const STAGGER_STEPS = 3
const STAGGER_FRACTION = 0.07
const EASE = 'cubic-bezier(0.41, 0, 0.12, 0.99)'
const HANDOVER_MS = 420
const NO_LINES = []

// Falloff either side of the focused line, indexed by distance. Subtle close in
// (so you can read ahead and behind), letting go further out.
const FALLOFF_ALPHA = [1, 0.62, 0.5, 0.42, 0.34]
const FALLOFF_BLUR = [0, 0.8, 1.2, 1.8, 2.4]
const UNSUNG = 'rgba(255,255,255,0.42)'
const SUNG = 'rgba(255,255,255,1)'


// Where the player actually is, read from the audio element every frame when
// possible (the store's `progress` only updates a few times a second).
export function useLyricClock(progress) {
  const anchor = useRef({ t: progress, at: performance.now() })
  useEffect(() => { anchor.current = { t: progress, at: performance.now() } }, [progress])
  return useCallback(() => {
    const s = usePlayerStore.getState()
    const el = s.activeAudioElement === 'cf' ? s.cfAudioRef?.current : s.audioRef?.current
    // Online radio: time from when the song started on the station.
    if (isStationTrack(s.currentTrack)) return el ? (stationSongTime(s.currentTrack, el.currentTime) ?? 0) : 0
    if (el && Number.isFinite(el.currentTime) && el.currentTime > 0) return el.currentTime
    const { t, at } = anchor.current
    return t + (s.isPlaying ? Math.min((performance.now() - at) / 1000, 0.6) : 0)
  }, [])
}

// ---------------------------------------------------------------- word markup

function sweepStyle() {
  return {
    display: 'inline-block',
    whiteSpace: 'pre',
    backgroundImage: `linear-gradient(90deg, ${SUNG} var(--lo, -0.6em), ${UNSUNG} var(--hi, 0em))`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    willChange: 'transform, background',
    // A touch of room so the glow and the lift aren't clipped by the line box.
    paddingBlock: '0.06em',
    marginBlock: '-0.06em',
  }
}

/** One vocal (lead or background): units grouped into unbreakable words. */
export function Voice({ units, text, wordSync, className, style, voiceRef }) {
  if (!wordSync || !units?.length) {
    return <span ref={voiceRef} data-voice="plain" dir="auto" className={className} style={style}>{text}</span>
  }
  const groups = groupUnits(units)
  return (
    <span ref={voiceRef} data-voice="timed" dir="auto" className={className} style={style}>
      {groups.map((group, gi) => {
        const grow = group.units.length === 1 && canGrow(group.units[0].unit)
        return (
          <React.Fragment key={gi}>
            {/* One unbreakable box per word; the space sits between boxes so
                the line can still wrap there (a space inside an inline-block
                would be collapsed away). */}
            <span style={{ display: 'inline-block', whiteSpace: 'nowrap' }}>
              {group.units.map(({ unit, index }) => (
                grow ? (
                  <span key={index} data-u={index} data-grow="1" style={{ display: 'inline-block', whiteSpace: 'pre' }}>
                    {Array.from(unit.word).map((ch, ci) => (
                      <span key={ci} data-l={ci} style={sweepStyle()}>{ch}</span>
                    ))}
                  </span>
                ) : (
                  <span key={index} data-u={index} style={sweepStyle()}>{unit.word}</span>
                )
              ))}
            </span>
            {group.space ? ' ' : null}
          </React.Fragment>
        )
      })}
    </span>
  )
}

// ---------------------------------------------------------------- per-frame painter

export function paintVoice(voiceEl, units, t, live) {
  if (!voiceEl || !units?.length) return
  const els = voiceEl.querySelectorAll('[data-u]')
  els.forEach((el) => {
    const u = units[Number(el.dataset.u)]
    if (!u) return
    if (el.dataset.grow) {
      const letters = el.querySelectorAll('[data-l]')
      const plan = growLetters(u)
      letters.forEach((lEl, li) => {
        const s = plan.sample(li, t)
        const p = live ? s.lit : (t >= u.end ? 1 : 0)
        // Feather sits wholly outside the letter at 0 and 1, so an unsung
        // narrow letter ("i", "l") is never caught half-lit.
        lEl.style.setProperty('--lo', `calc(${(p * 100).toFixed(2)}% + ${(p * 0.5 - 0.5).toFixed(3)}em)`)
        lEl.style.setProperty('--hi', `calc(${(p * 100).toFixed(2)}% + ${(p * 0.5).toFixed(3)}em)`)
        if (live) {
          lEl.style.transform = `translate3d(${s.shift.toFixed(3)}em, ${(-s.rise).toFixed(3)}em, 0) scale(${s.scale.toFixed(4)})`
          lEl.style.filter = s.bloom > 0.01 ? `drop-shadow(0 0 ${(0.12 + 0.3 * s.bloom).toFixed(3)}em rgba(255,255,255,${(0.55 * s.bloom).toFixed(3)}))` : ''
        } else {
          lEl.style.transform = ''
          lEl.style.filter = ''
        }
      })
      return
    }
    const p = live ? unitProgress(u, t) : (t >= u.end ? 1 : 0)
    // Feathered edge: the lit region runs to p, fading over ~1.2em around it.
    el.style.setProperty('--lo', `calc(${(p * 100).toFixed(2)}% + ${(p * 1.2 - 0.6).toFixed(3)}em - 0.6em)`)
    el.style.setProperty('--hi', `calc(${(p * 100).toFixed(2)}% + ${(p * 1.2 - 0.6).toFixed(3)}em + 0.6em)`)
    el.style.transform = live ? `translate3d(0, ${(-0.06 * unitLift(u, t)).toFixed(4)}em, 0)` : ''
  })
}

// ---------------------------------------------------------------- rows

const Row = React.memo(function Row({
  line, index, until, clock, distance, isFocused, isNext, isLive, synced, browsing, wordSync, fullscreen, textScale, duet, sub, onSeek, registerRow,
}) {
  const rowRef = useRef(null)
  const leadRef = useRef(null)
  const bgRef = useRef(null)
  const subRef = useRef(null)

  useEffect(() => {
    registerRow(index, { rowEl: rowRef.current, leadEl: leadRef.current, bgEl: bgRef.current, subEl: subRef.current })
    return () => registerRow(index, null)
  })

  const alignEnd = duet && line.side === 'end'
  const baseSize = (fullscreen ? 1.85 : 0.98) * textScale
  // `isLive` is only for the per-frame word painter. Visual focus is exclusive:
  // as soon as the next line takes focus, the previous line enters the same
  // handover transition instead of remaining bright during an overlap. This
  // makes fast, densely timed verses (Rap God is a good stress case) bounce
  // from one line to the next without two competing focal points.
  const near = isFocused ? 0 : distance
  const falloff = browsing ? 0.8 : FALLOFF_ALPHA[Math.min(near, FALLOFF_ALPHA.length - 1)]
  // The line after the one being sung stays sharp too (to read ahead); only
  // its blur goes, its colour and size stay those of the other lines.
  const blur = browsing || !synced || isNext ? 0 : FALLOFF_BLUR[Math.min(near, FALLOFF_BLUR.length - 1)]
  const lineOpacity = !synced ? 1 : near === 0 ? 1 : falloff
  const seekable = synced && Number.isFinite(line.time)

  if (line.gap) {
    const open = isFocused && synced
    const breakEnd = Number.isFinite(line.end) && line.end > line.time ? line.end : until
    const exitLead = line.outro ? 0.05 : FOCUS_LEAD_S + 0.04
    return (
      <div ref={rowRef} data-row={index} className="w-full" style={{ willChange: 'transform' }}>
        <div
          style={{
            height: open ? `${baseSize * 1.5}rem` : 0,
            opacity: open ? 1 : 0,
            transition: `height 420ms ${EASE}, opacity 360ms ${EASE}`,
            // Not clipped: the droplets' glow runs past the row and must fade
            // out on its own. Closed, the row is 0 high and fully transparent.
            display: 'flex',
            alignItems: 'center',
            justifyContent: alignEnd ? 'flex-end' : 'flex-start',
            paddingInline: '0.75rem',
          }}
        >
          <LyricBreakDots start={line.time} end={breakEnd - exitLead} getTime={clock} active={open} size={baseSize * 0.5} align={alignEnd ? 'end' : 'start'} />
        </div>
      </div>
    )
  }

  const hasBg = !!line.bgText
  const subText = sub?.text && sub.text !== line.text ? sub.text : null
  const subBg = sub?.bgText && sub.bgText !== line.bgText ? sub.bgText : null
  const subUnits = sub?.words?.length ? sub.words : null
  const bgUnits = line.bgWords || []

  return (
    <div ref={rowRef} data-row={index} className="w-full" style={{ willChange: 'transform' }}>
      <div
        role={seekable ? 'button' : undefined}
        tabIndex={seekable ? 0 : undefined}
        onClick={() => { if (!seekable) return; const sel = window.getSelection?.(); if (sel && !sel.isCollapsed && sel.toString().trim()) return; onSeek(line.time) }}
        onKeyDown={(e) => { if (seekable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSeek(line.time) } }}
        className={`group rounded-2xl outline-none select-text ${seekable ? 'cursor-pointer hover:bg-white/[0.06] focus-visible:bg-white/[0.06]' : 'cursor-default'}`}
        style={{
          padding: `${baseSize * 0.28}rem 0.75rem`,
          textAlign: alignEnd ? 'right' : 'left',
          marginLeft: duet && alignEnd ? '12%' : 0,
          marginRight: duet && !alignEnd ? '12%' : 0,
          opacity: lineOpacity,
          filter: blur > 0.05 ? `blur(${blur}px)` : 'none',
          transform: synced && near > 0 && !browsing ? 'scale(0.975)' : 'scale(1)',
          transformOrigin: alignEnd ? 'right center' : 'left center',
          // Colour, fade, blur and scale share one duration and curve so a
          // handover reads as one movement: the new line brightens exactly as
          // the old one recedes.
          transition: `opacity ${HANDOVER_MS}ms ${EASE}, filter ${HANDOVER_MS}ms ${EASE}, transform ${HANDOVER_MS}ms ${EASE}`,
        }}
      >
        <div
          dir="auto"
          style={{
            fontSize: `${baseSize}rem`,
            lineHeight: 1.22,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: synced ? (isFocused ? undefined : UNSUNG) : SUNG,
          }}
        >
          {synced && wordSync && line.words?.length ? (
            <Voice voiceRef={leadRef} units={line.words} text={line.text} wordSync />
          ) : (
            <span
              ref={leadRef}
              data-voice="plain"
              style={{ color: !synced ? SUNG : isFocused ? SUNG : UNSUNG, transition: `color ${HANDOVER_MS}ms ${EASE}` }}
            >
              {line.text || (line.blank ? '\u00a0' : '')}
            </span>
          )}
        </div>
        {hasBg && (
          <div style={{ fontSize: `${baseSize * 0.68}rem`, lineHeight: 1.25, fontWeight: 600, marginTop: '0.15em', opacity: 0.78 }}>
            {synced && wordSync && bgUnits.length ? (
              <Voice voiceRef={bgRef} units={bgUnits} text={line.bgText} wordSync />
            ) : (
              <span ref={bgRef} data-voice="plain" style={{ color: !synced || isFocused ? SUNG : UNSUNG, transition: `color ${HANDOVER_MS}ms ${EASE}` }}>{line.bgText}</span>
            )}
          </div>
        )}
        <AnimatePresence initial={false}>
          {(subText || subBg) && (
            <motion.div
              key="sub"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.42, ease: [0.41, 0, 0.12, 0.99] }}
              style={{ overflow: 'hidden' }}
            >
              <div ref={subRef} dir="auto" style={{ fontSize: `${baseSize * 0.56}rem`, lineHeight: 1.3, fontWeight: 600, marginTop: '0.2em', color: 'rgba(255,255,255,0.72)' }}>
                {subText && (synced && wordSync && subUnits ? <Voice units={subUnits} text={subText} wordSync /> : <span>{subText}</span>)}
                {subBg && <div style={{ fontSize: '0.85em', opacity: 0.8 }}>{subBg}</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------- toolbar

// The toolbar's pills fade out by themselves when the full-screen player
// hides its controls (their parent row must not fade: see the row).
const TOOLBAR_FADE = 'transition-[opacity,color,background-color] duration-300 group-data-[hidden=true]/toolbar:opacity-0'
// Moved up into the full-screen player's header row (toolbarTarget), the pills
// take that row's size.
const ToolbarLarge = createContext(false)
const pillSize = large => (large ? 'h-9 px-3.5 text-xs gap-1.5' : 'px-2.5 py-1 text-[11px] gap-1')

const SYNC_LABEL = { syllable: 'Syllable synced', line: 'Line synced', none: 'Not synced' }

// A thin bar sliding back and forth: this source is still being asked.
function SearchBar() {
  return (
    <span className="relative block h-[2px] w-full overflow-hidden rounded-full bg-white/[0.08]">
      <motion.span
        className="absolute inset-y-0 w-1/3 rounded-full bg-accent/70"
        animate={{ left: ['-33%', '100%'] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
      />
    </span>
  )
}

const FOUND = new Set(['syllable', 'line', 'none'])

function SourceMenu({ sources: allSources, enabled = null, current, attempts, busy, searching = false, pickingId = null, canEmbed = false, embeddingId = null, onEmbed, onPick, onRefresh, onSearch, rejected = [], onReject, hidden = false, openUp = false,
  // Lyrics Search's Check: the found lyrics are an entry of their own (never
  // inserted or rejected), and inserting puts a source's lyrics into the report.
  fixedIds = [], embedLabel = null, embedText = null,
  // ...where the found lyrics may be marked wrong too (rejectText(label, id) says what happens).
  rejectFixed = false, rejectText = null, onOpenChange = null }) {
  const { t } = useTranslation()
  const large = useContext(ToolbarLarge)
  const insertLabel = embedLabel || t('Insert into track')
  const [open, setOpen] = useState(false)
  // Sources marked wrong for this song aren't offered any more.
  const sources = allSources.filter(s => !rejected.includes(s.id))
  // A right click on a source (or on this button, for the one shown):
  // "Remove wrong lyrics" / "Insert into track", each confirmed first.
  const actions = useContextMenu()
  const [ask, setAsk] = useState(null) // { kind: 'reject' | 'embed', id }
  const openActions = (event, id) => {
    const fixed = fixedIds.includes(id)
    if (!id || id === 'local' || (fixed && !rejectFixed)) { event.preventDefault(); return }
    const found = FOUND.has(attempts?.[id]) || id === current
    const items = [
      onReject && { label: t('Remove wrong lyrics'), icon: Ban, danger: true, onSelect: () => setAsk({ kind: 'reject', id }) },
      canEmbed && found && !fixed && { label: insertLabel, icon: FileDown, disabled: !!embeddingId, onSelect: () => setAsk({ kind: 'embed', id }) },
    ].filter(Boolean)
    if (!items.length) { event.preventDefault(); return }
    actions.open(event, items)
  }
  const askLabel = allSources.find(s => s.id === ask?.id)?.label || ask?.id
  // "Insert into track" asks once more before writing to the file.
  const [confirmId, setConfirmId] = useState(null)
  useEffect(() => { if (!open) setConfirmId(null) }, [open])
  const ref = useRef(null)
  const panelRef = useRef(null)
  // The toolbar hid (full screen idle): the menu goes with it rather than
  // staying up, unclickable, over the lyrics.
  useEffect(() => { if (hidden) setOpen(false) }, [hidden])
  useEffect(() => { onOpenChange?.(open) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onOpenChange?.(false), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (!ref.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  // In a portal, placed by the button: the lyrics panel's own edges cut the
  // list off. It opens on the side with more room and scrolls past that.
  const [place, setPlace] = useState(null)
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return undefined }
    const measure = () => {
      const anchor = ref.current?.getBoundingClientRect()
      if (!anchor) return
      const margin = 8
      const below = window.innerHeight - anchor.bottom - margin - 6
      const above = anchor.top - margin - 6
      const up = openUp ? above >= 160 || above > below : below < 260 && above > below
      setPlace({
        // Lined up with the button's right edge, but kept on screen at the left
        // (the full-screen header has it near the left edge).
        right: Math.max(margin, Math.min(window.innerWidth - anchor.right, window.innerWidth - 256 - margin)),
        top: up ? undefined : anchor.bottom + 6,
        bottom: up ? window.innerHeight - anchor.top + 6 : undefined,
        maxHeight: Math.max(120, up ? above : below),
        up,
      })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, openUp])
  const label = sources.find(s => s.id === current)?.label || current
  return (
    // It takes the room left beside Translate/Romanize and shortens the
    // source's name to fit (a narrow sidebar cut it off at the edge).
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(o => !o)}
        onContextMenu={(e) => openActions(e, current)}
        aria-expanded={open}
        className={`flex max-w-full items-center ${pillSize(large)} rounded-full text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md ${TOOLBAR_FADE}`}
        title={label ? t('Lyrics source: {source}', { source: label }) : t('Lyrics source')}
      >
        {busy || searching ? <Loader2 size={large ? 13 : 11} className="flex-shrink-0 animate-spin" /> : null}
        <span className="min-w-0 max-w-[9rem] truncate">{label || (searching ? t('Searching...') : t('Source'))}</span>
        <ChevronDown size={large ? 13 : 11} className="flex-shrink-0" />
      </button>
      {createPortal(<AnimatePresence>
        {open && place && (
          <motion.div
            ref={panelRef}
            initial={{ opacity: 0, y: place.up ? 4 : -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: place.up ? 4 : -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            style={{ right: place.right, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, WebkitAppRegion: 'no-drag' }}
            className="fixed z-[200] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-white/10 bg-[#161616]/95 backdrop-blur-xl shadow-2xl p-1"
          >
            <p className="px-2.5 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-white/35">{t('Try another source')}</p>
            {sources.map(s => {
              const status = attempts?.[s.id]
              const note = status === 'syllable' ? t('Syllable') : status === 'line' ? t('Line') : status === 'none' ? t('Plain') : status === 'miss' ? t('Not found') : ''
              // Still being asked: a full search running (the file itself is
              // read first, so it's never pending), or this one picked.
              const pending = pickingId === s.id || (searching && s.id !== 'local' && !fixedIds.includes(s.id) && (!enabled || enabled.includes(s.id)))
              const embeddable = canEmbed && s.id !== 'local' && !fixedIds.includes(s.id) && FOUND.has(status) && !pending
              const embedding = embeddingId === s.id
              const confirming = confirmId === s.id
              return (
                <div key={s.id} className="flex items-center gap-1 rounded-lg hover:bg-white/[0.08]" onContextMenu={(e) => openActions(e, s.id)}>
                  <button
                    onClick={() => { setOpen(false); onPick(s.id) }}
                    className="flex-1 min-w-0 flex flex-col gap-1 px-2.5 py-1.5 text-left text-xs text-white/80"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="w-3.5 flex-shrink-0">{s.id === current ? <Check size={12} className="text-accent" /> : null}</span>
                      <span className="flex-1 truncate">{s.label}</span>
                      {pending
                        ? <span className="text-[10px] text-white/35">{t('Searching...')}</span>
                        : note && <span className={`text-[10px] ${status === 'miss' ? 'text-white/25' : 'text-white/45'}`}>{note}</span>}
                    </span>
                    {pending && <span className="block pl-5"><SearchBar /></span>}
                  </button>
                  {embeddable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (embeddingId) return
                        if (!confirming) { setConfirmId(s.id); return }
                        setConfirmId(null)
                        onEmbed?.(s.id)
                      }}
                      title={insertLabel}
                      className={`mr-1 flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] transition-colors ${confirming ? 'bg-accent text-black' : 'text-white/45 hover:text-white hover:bg-white/[0.1]'}`}
                    >
                      {embedding ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={11} />}
                      {confirming ? insertLabel : null}
                    </button>
                  )}
                </div>
              )
            })}
            <div className="h-px bg-white/10 my-1" />
            {/* The menu stays open, so the bars show each source being searched. */}
            <button onClick={() => onRefresh()} disabled={searching} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-white/70 hover:bg-white/[0.08] disabled:opacity-50">
              {searching ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} {t('Search all sources again')}
            </button>
            {onSearch && (
              <button onClick={() => { setOpen(false); onSearch() }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs text-white/70 hover:bg-white/[0.08]">
                <Search size={12} /> {t('Search manually...')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
      <ContextMenu menu={actions} />
      <Modal open={!!ask} onClose={() => setAsk(null)} title={ask?.kind === 'reject' ? t('Remove wrong lyrics?') : `${insertLabel}?`} width="max-w-sm">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            {ask?.kind === 'reject'
              ? rejectText ? rejectText(askLabel, ask.id) : t("The lyrics from {source} will be hidden for this song, and {source} won't be offered for it again.", { source: askLabel })
              : embedText ? embedText(askLabel) : t("The lyrics from {source} will be written into the song's file, replacing the lyrics it has.", { source: askLabel })}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setAsk(null)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">{t('Cancel')}</button>
            <button autoFocus onClick={() => {
              const kind = ask?.kind
              const id = ask?.id
              setAsk(null)
              setOpen(false)
              if (kind === 'reject') onReject?.(id)
              else onEmbed?.(id)
            }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors ${ask?.kind === 'reject' ? 'bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30' : 'bg-accent/20 border border-accent/30 text-accent hover:bg-accent/30'}`}>
              {ask?.kind === 'reject' ? t('Remove') : insertLabel}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Pill({ active, onClick, children, title, disabled }) {
  const large = useContext(ToolbarLarge)
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`flex items-center ${pillSize(large)} rounded-full ${TOOLBAR_FADE} disabled:opacity-40 ${active ? 'bg-white text-black' : 'text-white/60 hover:text-white bg-white/[0.08] hover:bg-white/[0.14] backdrop-blur-md'}`}
    >
      {children}
    </button>
  )
}

// The side panel's "Size" button: a small slider right above it for the lyrics
// size (the same setting as Settings > Appearance > Side Panel Lyrics Size).
function SizePill({ onOpenChange, openUp = true }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const scale = useSideLyricsScale()
  const percent = sideLyricsPercent(scale)
  const ref = useRef(null)
  const toggle = (next) => { setOpen(next); onOpenChange?.(next) }
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!ref.current?.contains(e.target)) toggle(false) }
    const onKey = (e) => { if (e.key === 'Escape') toggle(false) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="relative">
      <Pill active={open} onClick={() => toggle(!open)} title={t('Lyrics size')}>
        <ALargeSmall size={12} />
        {t('Size')}
      </Pill>
      {open && (
        <div className={`absolute left-0 ${openUp ? 'bottom-full mb-2' : 'top-full mt-2'} z-40 w-64 rounded-xl border border-white/10 bg-black/85 px-3 py-2.5 backdrop-blur-md shadow-xl`}>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/60">
            <span>{t('Lyrics size')}</span>
            <span className="tabular-nums text-white">{percent}%</span>
          </div>
          <input
            type="range"
            min={SIDE_LYRICS_PERCENT.min}
            max={SIDE_LYRICS_PERCENT.max}
            step={SIDE_LYRICS_PERCENT.step}
            value={percent}
            onChange={(e) => setSideLyricsPercent(e.target.value)}
            onDoubleClick={() => setSideLyricsPercent(SIDE_LYRICS_PERCENT.initial)}
            title={t('Double-click to reset')}
            className="block w-full h-5 cursor-pointer accent-accent"
          />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- panel

// Lyrics already fetched, per song, shared by every panel (sidebar, full-screen
// player side panel, full-screen lyrics). A panel opened for a song another one
// already shows starts with its lines on the first frame (and refreshes them
// quietly), instead of "no lyrics", then a skeleton, then the lines.
function Loading() {
  return (
    <div className="w-full flex flex-col gap-5 px-3 pt-4">
      {[0.92, 0.6, 0.8, 0.45, 0.7].map((w, i) => (
        <motion.div
          key={i}
          className="h-6 rounded-lg bg-white/[0.08]"
          style={{ width: `${w * 100}%` }}
          animate={{ opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.1 }}
        />
      ))}
    </div>
  )
}

export default function LyricsPanel({
  track: shownTrack, progress, fullscreen = false, wordSync = true, onLyricsAvailable, onSearchRequest, textScale = 1, isAutoSynced: autoSyncWanted = false,
  // The full screen player hides the buttons along with its own after a few
  // seconds without the mouse moving.
  toolbarHidden = false,
  // The side panel: while there are no lines to show (still searching after
  // a second, or none found), it shows its visualization behind this panel
  // instead of the grey placeholder lines or the empty message, and "no
  // lyrics" becomes a bubble at the bottom. onIdleChange(true/false) says when.
  idleVisual = false, onIdleChange,
  // Room kept at the toolbar's right end (the side panel's tab button sits there).
  toolbarEndGap = false,
  // The side panel's Visualization + Lyrics tab: the buttons sit along the
  // bottom instead, unseen until the mouse is over them.
  toolbarAtBottom = false,
  // The side panel: a "Size" button for its lyrics size, before Translate.
  sizeControl = false,
  // The list fades out at its top and bottom edges (the side panel's Lyrics tab goes without).
  edgeFade = true,
  // The full screen player: the buttons go into its header row (this element)
  // instead of over the lyrics; toolbarConcealed fades them out there (until
  // the mouse comes near) without closing the source menu, and
  // onToolbarMenuChange says while that menu is open.
  toolbarTarget = null, toolbarConcealed = false, onToolbarMenuChange = null,
}) {
  const { t } = useTranslation()
  // Online radio: the song playing on the station, under its own id.
  const track = useMemo(() => lyricsTrackFor(shownTrack), [shownTrack])
  const setProgressWithAudioUpdate = usePlayerStore(s => s.setProgressWithAudioUpdate)
  const syncTrack = usePlayerStore(s => s.syncTrack)
  const now = useLyricClock(progress)
  const [loadedResult, setResult] = useState(() => (track?.id && hasCachedLyrics(track.id) ? peekLyrics(track.id) : null))
  // Lyrics Search's Check: the lyrics found for this song, shown in place of
  // its own while it's being checked (nothing is saved).
  const foundPreview = useLyricsPreviewFor(track?.id)
  // Another source picked from the menu while checking: { trackId, id, result }.
  const [checkPick, setCheckPick] = useState(null)
  const [checkAttempts, setCheckAttempts] = useState({ trackId: null, attempts: {} })
  const [checkPickingId, setCheckPickingId] = useState(null)
  const [checkSearching, setCheckSearching] = useState(false)
  const [checkInserting, setCheckInserting] = useState(null)
  const picked = foundPreview && checkPick?.trackId === track?.id ? checkPick : null
  const previewResult = foundPreview ? (picked?.result || foundPreview) : null
  // Online radio: always plain text (synced lyrics lose their time stamps).
  const station = isStationTrack(track)
  const shownResult = previewResult || loadedResult
  const result = useMemo(() => (station ? stationPlainLyrics(shownResult) : shownResult), [station, shownResult])
  // ...and not followed along roughly either.
  const isAutoSynced = autoSyncWanted && !station
  // The song `result` is for: right after the song changes, until the new
  // song's lyrics are in, it's still the previous one's.
  const [resultFor, setResultFor] = useState(() => (track?.id && hasCachedLyrics(track.id) ? track.id : null))
  const setBoundResult = useCallback((trackId, next) => { setResultFor(trackId ?? null); setResult(next) }, [])
  // Loading from the first render when there's nothing to show yet, so a new
  // panel never flashes "no lyrics" before its request has even started.
  const [loadingState, setLoading] = useState(() => !!track?.id && !hasCachedLyrics(track.id))
  const loading = !previewResult && loadingState
  const [sourceBusy, setSourceBusy] = useState(false)
  // The source being asked from the menu, a full re-search running, and the
  // source whose lyrics are being written into the file.
  const [pickingId, setPickingId] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [embeddingId, setEmbeddingId] = useState(null)
  const [notice, setNotice] = useState('')
  const [sources, setSources] = useState([])
  // Sources the user marked wrong for this song ("Remove wrong lyrics").
  const [rejected, setRejected] = useState([])
  const [enabledSources, setEnabledSources] = useState(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const [focusIdx, setFocusIdx] = useState(-1)
  const [liveKey, setLiveKey] = useState('')
  const [browsing, setBrowsing] = useState(false)

  const containerRef = useRef(null)
  const rowsRef = useRef(new Map())
  const browseTimer = useRef(null)
  const lastScrollIdx = useRef(-1)
  const paintedRows = useRef(new Set())

  const crossfadeSeconds = usePlayerStore(s => s.crossfadeSeconds)
  // "Instrumental track without lyrics" and "Невозможно нагуглить слова этого
  // трека" (what the file says for an instrumental, or for a song whose words
  // can't be found; see electron/lyrics/fileLyrics.js) are not lines to show.
  const markerText = useMemo(() => {
    const words = (result?.lines || []).map(line => line.text || '').join(' ').replace(/\s+/g, ' ').trim()
    if (/^instrumental track without lyrics\.?$/i.test(words)) return 'instrumental'
    if (/^невозможно нагуглить слова этого трека\.?$/i.test(words)) return 'unfound'
    return null
  }, [result])
  const instrumentalText = markerText === 'instrumental'
  const unfoundText = markerText === 'unfound'
  const lines = useMemo(
    () => (markerText ? [] : withOutroBreak(result?.lines || [], { duration: track?.duration, crossfade: crossfadeSeconds, synced: result?.type === 'synced' })),
    [result, markerText, track?.duration, crossfadeSeconds],
  )
  // Online radio never gets here synced (see stationPlainLyrics above).
  const synced = result?.type === 'synced'

  // ---- data
  const trackKey = track?.id
  // Async answers are only applied if they're still for what's on screen.
  // The sidebar and side panel keep this component mounted across track
  // changes, so a slow lookup for the previous song could otherwise land after
  // the next song's and replace its lyrics (same for translations, romanization
  // and the source picker).
  const requestSeq = useRef(0)
  const resultRef = useRef(null)
  resultRef.current = loadedResult

  // quiet: lines already on screen (from the cache) stay up while this
  // refreshes them; the answer only replaces them if it's different.
  const load = useCallback((opts = {}, quiet = false) => {
    if (!track?.id) return
    const seq = ++requestSeq.current
    const trackId = track.id
    const station = isStationTrack(track)
    // A station before its first song: nothing to look up.
    if (station && !track.song_key) { setBoundResult(trackId, null); setLoading(false); setRefreshing(false); return }
    // Lyrics the station's own API sent come first.
    if (station && track.song_lyrics && !opts.refresh) {
      const lines = String(track.song_lyrics).split(/\r?\n/).map(text => ({ text, time: null, words: [] }))
      const next = { type: 'plain', source: 'station', lines }
      cacheLyrics(trackId, next)
      setBoundResult(trackId, next)
      setLoading(false)
      return
    }
    if (!quiet) setLoading(true)
    setRefreshing(!!opts.refresh)
    setNotice('')
    // A station's song isn't a library row: no id, so nothing is saved for it.
    api.getLyrics(station ? null : track.id, track.title, track.artist, station ? '' : track.album, track.duration, track.file_path, opts)
      .then(r => {
        if (seq !== requestSeq.current) return
        const next = r && (r.lines?.length || r.instrumental) ? r : null
        cacheLyrics(trackId, next)
        // Same lyrics as shown: keep the scroll position and translations.
        if (quiet && JSON.stringify(next) === JSON.stringify(resultRef.current)) return
        setBoundResult(trackId, next)
        // A refreshed result has different lines: drop the scroll position
        // that belonged to the previous one (its translations go with it).
        lastScrollIdx.current = -1
      })
      .catch(() => { if (seq === requestSeq.current && !quiet) setBoundResult(trackId, null) })
      .finally(() => { if (seq === requestSeq.current) { setLoading(false); setRefreshing(false) } })
  }, [track?.id, track?.title, track?.artist, track?.album, track?.duration, track?.file_path, track?.song_key, track?.song_lyrics, setBoundResult])

  // Manual search. The fullscreen views bring their own drawer (onSearchRequest);
  // anywhere else -- the sidebar -- the panel opens one over itself.
  const [searchOpen, setSearchOpen] = useState(false)
  const requestSearch = onSearchRequest || (() => setSearchOpen(true))
  const currentTrackId = useRef(track?.id)
  currentTrackId.current = track?.id
  const pickSearchResult = async (lyrics, type) => {
    setSearchOpen(false)
    const trackId = track?.id
    if (!trackId) return
    try { await api.importLyrics(trackId, lyrics, type) } catch {}
    announceLyricsChanged(trackId)
    // The song may have changed while saving; its own load already ran.
    if (currentTrackId.current === trackId) load()
  }

  useEffect(() => {
    setSearchOpen(false)
    // A source request for the previous song won't clear its own spinner
    // (its answer is dropped as stale), so clear it here.
    setSourceBusy(false)
    setPickingId(null)
    setRefreshing(false)
    setEmbeddingId(null)
    const cached = trackKey != null && hasCachedLyrics(trackKey)
    // Cached: its lines show right away (even if the previous song was still
    // loading); otherwise the loading state until this song's answer.
    setBoundResult(cached ? trackKey : null, cached ? peekLyrics(trackKey) : null); setLoading(!cached && trackKey != null); setFocusIdx(-1); lastScrollIdx.current = -1
    // Being checked (Lyrics Search): its own lyrics are read once the check is over.
    if (!previewRef.current) load({}, cached)
  }, [trackKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // A check ended (another song, Save or Cancel in Lyrics Search) with this
  // song still here: its own lyrics again.
  const previewRef = useRef(previewResult)
  const wasPreview = previewRef.current
  previewRef.current = previewResult
  useEffect(() => { setCheckPick(null); setCheckPickingId(null); setCheckSearching(false) }, [foundPreview])
  useEffect(() => {
    if (wasPreview && !previewResult) { lastScrollIdx.current = -1; load({}, false) }
    else if (previewResult) lastScrollIdx.current = -1
  }, [previewResult]) // eslint-disable-line react-hooks/exhaustive-deps

  // The file's own lyrics changed (here or in the tag editor): read them again.
  useEffect(() => {
    if (trackKey == null) return undefined
    const onChanged = (e) => { if (String(e.detail?.trackId) === String(trackKey)) load({}, true) }
    window.addEventListener('lokal:lyrics-file-changed', onChanged)
    return () => window.removeEventListener('lokal:lyrics-file-changed', onChanged)
  }, [trackKey, load])

  useEffect(() => { if (!loading) onLyricsAvailable?.(lines.length > 0) }, [loading, lines.length, onLyricsAvailable])

  // Lyrics from the file come in at once: the visualization waits a second
  // before taking over from a search that is still running.
  const [slowSearch, setSlowSearch] = useState(false)
  useEffect(() => {
    setSlowSearch(false)
    if (!idleVisual || !loading) return undefined
    const timer = setTimeout(() => setSlowSearch(true), 1000)
    return () => clearTimeout(timer)
  }, [idleVisual, loading, trackKey])
  // Once showing, it stays until there are lines (Try again, the next song)
  // rather than going away for that second and coming back.
  const [heldIdle, setHeldIdle] = useState(false)
  // A song the library already knows is instrumental (or has no words to
  // find) doesn't wait.
  const knownKind = track?.lyrics_kind || shownTrack?.lyrics_kind
  const knownInstrumental = knownKind === 'instrumental'
  const knownUnfound = knownKind === 'unfound'
  const idle = idleVisual && !lines.length && (!loading || slowSearch || heldIdle || knownInstrumental || knownUnfound)
  if (heldIdle !== idle) setHeldIdle(idle)
  useEffect(() => { onIdleChange?.(idle) }, [idle, onIdleChange])
  useEffect(() => () => onIdleChange?.(false), [onIdleChange])

  useEffect(() => {
    api.getLyricsSources?.().then(s => { setSources(s?.providers || []); setEnabledSources(Array.isArray(s?.enabled) ? s.enabled : null) }).catch(() => {})
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // ---- translation / romanization (src/lyrics/useLyricSubline.js)
  const {
    subline, toggle: toggleSub, subLines, wantTranslation, translateTarget, translationState, romanizationState,
    translationFrom, translationBusy, romanizationBusy, canRomanize,
  } = useLyricSubline(previewResult || (resultFor != null && resultFor === track?.id)
    ? { trackId: track?.id, result, lines }
    // Lyrics still the previous song's: no translating them under this song's name.
    : { trackId: track?.id, result: null, lines: NO_LINES })

  // ---- focus (which line the panel is centred on)
  const nextTimes = useMemo(() => lines.map((l, i) => {
    const n = lines.slice(i + 1).find(x => x.time != null)
    return n ? n.time : (track?.duration || (l.time ?? 0) + 4)
  }), [lines, track?.duration])

  useEffect(() => {
    if (!lines.length) return
    if (synced) {
      const t = now()
      const focus = focusRow(lines, t + FOCUS_LEAD_S)
      setFocusIdx(focus)
      setLiveKey(stillSinging(lines, t, focus).join(','))
    } else if (isAutoSynced && track?.duration) {
      setFocusIdx(Math.min(lines.length - 1, Math.floor((progress / track.duration) * lines.length)))
    } else {
      setFocusIdx(-1)
    }
  }, [progress, lines, synced, isAutoSynced, track?.duration, now])

  // ---- per-frame painting of what is actually being sung
  const registerRow = useCallback((index, refs) => {
    if (refs) rowsRef.current.set(index, refs)
    else rowsRef.current.delete(index)
  }, [])

  useEffect(() => {
    if (!synced || !lines.length) return
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const t = now()
      const live = new Set(activeRows(lines, t))
      // Lines that just stopped being sung get settled into their final state once.
      for (const i of paintedRows.current) {
        if (live.has(i)) continue
        const refs = rowsRef.current.get(i)
        const line = lines[i]
        if (refs && line && wordSync) {
          paintVoice(refs.leadEl, line.words, t, false)
          paintVoice(refs.bgEl, line.bgWords, t, false)
        }
      }
      for (const i of live) {
        const refs = rowsRef.current.get(i)
        const line = lines[i]
        if (!refs || !line) continue
        if (line.gap) continue
        if (!wordSync) continue
        paintVoice(refs.leadEl, line.words, t, true)
        paintVoice(refs.bgEl, line.bgWords, t, true)
        const sub = subLines?.[i]
        if (sub?.words?.length && refs.subEl) paintVoice(refs.subEl.querySelector('[data-voice="timed"]'), sub.words, t, true)
      }
      paintedRows.current = live
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [synced, lines, nextTimes, now, wordSync, subLines])

  // When the list re-renders, bring every timed line to its correct resting state.
  useLayoutEffect(() => {
    if (!synced || !wordSync) return
    const t = now()
    rowsRef.current.forEach((refs, i) => {
      const line = lines[i]
      if (!line || line.gap) return
      paintVoice(refs.leadEl, line.words, t, false)
      paintVoice(refs.bgEl, line.bgWords, t, false)
    })
  }, [lines, synced, wordSync, focusIdx, subLines, now])

  // ---- scrolling: native scroll for browsing, a staggered glide for following
  const anchorFraction = fullscreen ? 0.22 : 0.26
  // Full screen, the lyrics start at the top (clear of the buttons and the
  // edge fade) rather than a third of the way down; the line being sung
  // settles at anchorFraction once the song gets there.
  const FULLSCREEN_TOP = { height: '10%', minHeight: '4.5rem' }
  const scrollToFocus = useCallback((instant) => {
    const container = containerRef.current
    const refs = rowsRef.current.get(focusIdx)
    if (!container || !refs?.rowEl) return
    // Near the end of a song the list can't scroll far enough to put the line
    // at the anchor (the sidebar keeps no empty space after the last line), so
    // clamp to how far it can actually go. The last lines then simply light up
    // lower down the panel instead of the list trying to move.
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight)
    const target = Math.min(maxScroll, Math.max(0, refs.rowEl.offsetTop - container.clientHeight * anchorFraction))
    const before = container.scrollTop
    if (Math.abs(target - before) < 1) return
    markAutoScroll(container)
    if (instant || Math.abs(target - before) > container.clientHeight * 1.5) {
      container.scrollTop = target
      return
    }
    // FLIP: jump the scroll position, then let each row glide the difference
    // back to zero -- rows below the focus leave a beat later than the one
    // above, so the spacing opens and closes like the list is handing over.
    // The glide uses the distance the scroll really moved; gliding by the
    // intended distance when the scroll was clamped made every row jump and
    // settle back to where it already was (the end-of-song jitter).
    container.scrollTop = target
    const delta = container.scrollTop - before
    if (Math.abs(delta) < 1) return
    const top = container.scrollTop
    const bottom = top + container.clientHeight
    rowsRef.current.forEach(({ rowEl }, i) => {
      if (!rowEl) return
      const y = rowEl.offsetTop
      if (y + rowEl.offsetHeight < top - 200 || y > bottom + 200) return
      const steps = i > focusIdx ? Math.min(i - focusIdx, STAGGER_STEPS) : 0
      rowEl.style.transition = 'none'
      rowEl.style.transform = `translate3d(0, ${delta}px, 0)`
      // Force the start frame, then release.
      void rowEl.offsetHeight
      rowEl.style.transition = `transform ${SCROLL_MS}ms ${EASE} ${Math.round(steps * STAGGER_FRACTION * SCROLL_MS)}ms`
      rowEl.style.transform = ''
    })
  }, [focusIdx, anchorFraction])

  useLayoutEffect(() => {
    if (focusIdx < 0 || browsing) return
    const first = lastScrollIdx.current < 0
    lastScrollIdx.current = focusIdx
    scrollToFocus(first)
  }, [focusIdx, browsing, scrollToFocus])

  const startBrowsing = useCallback(() => {
    if (!synced && !isAutoSynced) return
    setBrowsing(true)
    clearTimeout(browseTimer.current)
    browseTimer.current = setTimeout(() => setBrowsing(false), BROWSE_IDLE_MS)
  }, [synced, isAutoSynced])
  useEffect(() => () => clearTimeout(browseTimer.current), [])

  // ---- actions
  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return
    setBrowsing(false)
    setProgressWithAudioUpdate(Math.max(0, time))
  }, [setProgressWithAudioUpdate])

  const pickSource = (id) => {
    if (!track?.id) return
    const seq = ++requestSeq.current
    setSourceBusy(true)
    setPickingId(id)
    setRefreshing(false)
    api.getLyricsFrom(id, track.id, track.title, track.artist, track.album, track.duration, track.file_path)
      .then(r => {
        if (seq !== requestSeq.current) return
        if (r?.lines?.length) {
          setBoundResult(track.id, r)
          announceLyricsChanged(track.id)
          lastScrollIdx.current = -1
        } else {
          const label = sources.find(s => s.id === id)?.label || id
          setNotice(t("{source} doesn't have this song", { source: label }))
          setResult(prev => (prev ? { ...prev, attempts: { ...(prev.attempts || {}), ...(r?.attempts || {}) } } : prev))
          setTimeout(() => setNotice(''), 3500)
        }
      })
      .catch(() => {})
      .finally(() => { if (seq === requestSeq.current) { setSourceBusy(false); setPickingId(null) } })
  }

  // ---- Lyrics Search's Check: other sources asked without caching anything;
  // "Insert into report" makes one the song's entry there (saved later).
  const CHECK_ID = 'lyrics-search'
  const checkSay = (text) => { setNotice(text); setTimeout(() => setNotice(''), 4000) }
  const checkLabel = (id) => (id === CHECK_ID ? t('Found') : sources.find(s => s.id === id)?.label || id)
  const checkPickSource = (id) => {
    const trackId = track?.id
    if (!trackId) return
    if (id === CHECK_ID) { setCheckPick(null); lastScrollIdx.current = -1; return }
    setCheckPickingId(id)
    api.lyricsSearchFromSource(trackId, id)
      .then(r => {
        if (currentTrackId.current !== trackId) return
        setCheckAttempts(prev => ({ trackId, attempts: { ...(prev.trackId === trackId ? prev.attempts : {}), ...(r?.attempts || {}) } }))
        if (r?.result && (r.result.lines?.length || r.result.instrumental)) {
          setCheckPick({ trackId, id, result: { ...r.result, source: id } })
          lastScrollIdx.current = -1
          if (!r.usable) checkSay(t('These lyrics are not a level above the ones in the file, so they can’t go into the report.'))
        } else checkSay(t("{source} doesn't have this song", { source: checkLabel(id) }))
      })
      .catch(() => {})
      .finally(() => setCheckPickingId(null))
  }
  const checkSearchAll = () => {
    const trackId = track?.id
    if (!trackId || checkSearching) return
    setCheckSearching(true)
    api.lyricsSearchAllSources(trackId)
      .then(r => { if (currentTrackId.current === trackId) setCheckAttempts({ trackId, attempts: r?.attempts || {} }) })
      .catch(() => {})
      .finally(() => setCheckSearching(false))
  }
  const checkInsert = (id) => {
    const trackId = track?.id
    if (!trackId || checkInserting) return
    setCheckInserting(id)
    api.lyricsSearchUseSource(trackId, id)
      .then(async r => {
        if (r?.ok) {
          const next = await api.lyricsSearchPreview(trackId).catch(() => null)
          if (next) showLyricsPreview(trackId, next)
          window.dispatchEvent(new CustomEvent('lokal:lyrics-search-entry', { detail: { trackId, toKind: r.toKind, source: r.source } }))
          checkSay(t('Lyrics from {source} put into the report', { source: checkLabel(id) }))
        } else {
          checkSay(r?.error === 'not-higher' ? t('These lyrics are not a level above the ones in the file, so they can’t go into the report.')
            : r?.error === 'no-lyrics' ? t("{source} doesn't have this song", { source: checkLabel(id) }) : t("Couldn't save the lyrics: {error}", { error: r?.error || '?' }))
        }
      })
      .catch(e => checkSay(t("Couldn't save the lyrics: {error}", { error: e?.message || '?' })))
      .finally(() => setCheckInserting(null))
  }

  // "Remove wrong lyrics" while checking: the source is marked wrong for the
  // song; when its lyrics were the report's, another source's take their
  // place, or the song leaves the report when there are none.
  const checkReject = (id) => {
    const trackId = track?.id
    if (!trackId || checkInserting) return
    const label = id === CHECK_ID ? (checkLabel(foundPreview?.foundSource) || t('Found')) : checkLabel(id)
    setCheckInserting(id)
    api.lyricsSearchReject(trackId, id)
      .then(async r => {
        if (Array.isArray(r?.rejected) && currentTrackId.current === trackId) setRejected(r.rejected)
        if (!r?.ok) { checkSay(t("Couldn't mark the lyrics as wrong: {error}", { error: r?.error || '?' })); return }
        if (checkPick?.id === id || r.replaced) setCheckPick(null)
        if (r.removed) {
          clearLyricsPreview([trackId])
          window.dispatchEvent(new CustomEvent('lokal:lyrics-search-removed', { detail: { trackId } }))
          checkSay(t('Lyrics from {source} marked as wrong. No other lyrics were found, so the track was taken out of the report', { source: label }))
        } else if (r.replaced) {
          lastScrollIdx.current = -1
          const next = await api.lyricsSearchPreview(trackId).catch(() => null)
          if (next) showLyricsPreview(trackId, next)
          window.dispatchEvent(new CustomEvent('lokal:lyrics-search-entry', { detail: { trackId, toKind: r.toKind, source: r.source } }))
          checkSay(t('Lyrics from {source} marked as wrong. The report now has the lyrics from {next}', { source: label, next: checkLabel(r.source) }))
        } else checkSay(t('Lyrics from {source} marked as wrong', { source: label }))
      })
      .catch(e => checkSay(t("Couldn't mark the lyrics as wrong: {error}", { error: e?.message || '?' })))
      .finally(() => setCheckInserting(null))
  }

  // "Insert into track": that source's lyrics go into the file's tags (LRC +
  // SYLT when synced, plain text otherwise). Then the file is read again.
  const hasFile = !!track?.file_path && !/^(ghost|https?):/i.test(String(track.file_path))
  const embedSource = (id) => {
    if (!track?.id || embeddingId) return
    const trackId = track.id
    const label = sources.find(s => s.id === id)?.label || id
    const say = (text) => { setNotice(text); setTimeout(() => setNotice(''), 4000) }
    setEmbeddingId(id)
    api.embedLyricsFrom(id, trackId, track.title, track.artist, track.album, track.duration)
      .then(r => {
        if (currentTrackId.current !== trackId) return
        if (r?.ok) {
          say(t('Lyrics from {source} saved into the file', { source: label }))
          if (r.lyricsKind) syncTrack({ ...track, lyrics_kind: r.lyricsKind })
          announceLyricsFileChanged(trackId)
          announceTrackChanged(trackId)
        } else {
          say(r?.error === 'no-lyrics' ? t("{source} doesn't have this song", { source: label }) : t("Couldn't save the lyrics: {error}", { error: r?.error || '?' }))
        }
      })
      .catch(e => say(t("Couldn't save the lyrics: {error}", { error: e?.message || '?' })))
      .finally(() => setEmbeddingId(null))
  }

  useEffect(() => {
    setRejected([])
    if (!trackKey) return undefined
    let alive = true
    Promise.resolve(api.getRejectedLyricsSources?.(trackKey))
      .then(list => { if (alive && Array.isArray(list)) setRejected(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [trackKey])

  // "Remove wrong lyrics": the source is never asked for this song again;
  // when its lyrics were the ones shown, the other sources are asked.
  const rejectSource = (id) => {
    if (!track?.id) return
    const seq = ++requestSeq.current
    const trackId = track.id
    const label = sources.find(s => s.id === id)?.label || id
    setRejected(prev => (prev.includes(id) ? prev : [...prev, id]))
    const shown = resultRef.current?.source === id
    if (shown) setLoading(true)
    api.rejectLyricsSource(id, trackId, track.title, track.artist, track.album, track.duration)
      .then(r => {
        if (Array.isArray(r?.rejected) && currentTrackId.current === trackId) setRejected(r.rejected)
        if (seq !== requestSeq.current || !shown) return
        const next = r?.result && (r.result.lines?.length || r.result.instrumental) ? r.result : null
        cacheLyrics(trackId, next)
        setBoundResult(trackId, next)
        announceLyricsChanged(trackId)
        lastScrollIdx.current = -1
      })
      .catch(() => {})
      .finally(() => {
        if (seq === requestSeq.current) setLoading(false)
        setNotice(t('Lyrics from {source} marked as wrong', { source: label }))
        setTimeout(() => setNotice(''), 3500)
      })
  }

  // ---- render
  // The next line to be sung after the focused one (a break between them doesn't count).
  const nextLineIdx = useMemo(() => {
    if (focusIdx < 0) return -1
    for (let i = focusIdx + 1; i < lines.length; i++) if (!lines[i]?.gap) return i
    return -1
  }, [focusIdx, lines])
  const liveSet = useMemo(() => new Set(liveKey ? liveKey.split(',').map(Number) : []), [liveKey])
  const sourceLabel = sources.find(s => s.id === result?.source)?.label || result?.source
  const attribution = result?.attribution
  const hasContributors = !!(attribution?.uploader || attribution?.maker)
  const searching = loading || refreshing
  const unfound = !result?.instrumental && !instrumentalText && (unfoundText || (knownUnfound && !lines.length))
  const instrumental = !unfound && (!!result?.instrumental || instrumentalText || (knownInstrumental && !lines.length))
  // Either way there's nothing to look for: a note in place of "No lyrics found".
  const noLyricsNote = instrumental ? t('Instrumental track: no lyrics') : unfound ? t("These lyrics can't be found: the track's tag says so") : null
  // The source menu also shows while searching, so its bars can be watched.
  const showToolbar = lines.length > 0 || (searching && sources.length > 0)
  const [toolbarHover, setToolbarHover] = useState(false)
  // The size slider stays up while it's open, even once the mouse leaves the row.
  const [sizeOpen, setSizeOpen] = useState(false)
  const toolbarFaded = toolbarAtBottom ? !(toolbarHover || sizeOpen) : toolbarHidden

  // Hidden over the visualization (no lines to show): the mouse goes through
  // to it (the splashes follow it), only the small notes and buttons take it.
  const passThrough = idleVisual && idle && !searchOpen
  return (
    <div className={`relative w-full h-full ${passThrough ? 'pointer-events-none' : 'pointer-events-auto'}`}>
      {showToolbar && toolbarTarget && createPortal(
        <ToolbarLarge.Provider value>
          <div data-hidden={toolbarHidden || toolbarConcealed} className="group/toolbar flex items-center gap-2">
          <div className={`flex flex-shrink-0 items-center gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'} ${lines.length ? '' : toolbarTarget ? 'hidden' : 'invisible'}`} inert={toolbarHidden || !lines.length}>
            {sizeControl && <SizePill onOpenChange={setSizeOpen} openUp={toolbarAtBottom} />}
            <Pill active={wantTranslation} onClick={() => toggleSub('translation')} title={t('Show translation ({language})', { language: translateTarget })}>
              {translationBusy ? <Loader2 size={toolbarTarget ? 13 : 11} className="animate-spin" /> : <Languages size={toolbarTarget ? 13 : 11} />}
              {t('Translate')}
            </Pill>
            {canRomanize && (
              <Pill active={subline === 'romanization'} onClick={() => toggleSub('romanization')} title={t('Show pronunciation in Latin letters')}>
                {romanizationBusy ? <Loader2 size={toolbarTarget ? 13 : 11} className="animate-spin" /> : <span className="font-semibold leading-none">Aa</span>}
                {t('Romanize')}
              </Pill>
            )}
          </div>
          {!toolbarTarget && <div className="flex-1" />}
          <div className={`flex min-w-0 items-center justify-end gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'}`} inert={toolbarHidden}>
            {previewResult && (
              // Lyrics Search's Check: says what this is, beside the source menu.
              <span
                className={`flex flex-shrink-0 items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-accent bg-white/[0.08] backdrop-blur-md ${TOOLBAR_FADE}`}
                title={t('Lyrics found by Lyrics Search, not saved anywhere yet')}
              >
                <ScanSearch size={11} className="flex-shrink-0" />
                <span className="whitespace-nowrap">{t('Checking lyrics')}</span>
              </span>
            )}
            {previewResult ? (
              <SourceMenu
                sources={[{ id: CHECK_ID, label: t('Found') }, ...sources.filter(s => s.id !== 'local')]}
                enabled={enabledSources}
                current={picked?.id || CHECK_ID}
                attempts={{ ...(checkAttempts.trackId === track?.id ? checkAttempts.attempts : {}), [CHECK_ID]: foundPreview?.instrumental ? 'instrumental' : foundPreview?.sync }}
                busy={!!checkPickingId || !!checkInserting}
                searching={checkSearching}
                pickingId={checkPickingId}
                canEmbed
                embeddingId={checkInserting}
                onEmbed={checkInsert}
                onPick={checkPickSource}
                onRefresh={checkSearchAll}
                fixedIds={[CHECK_ID]}
                rejected={rejected}
                onReject={checkReject}
                rejectFixed
                rejectText={(label, id) => (id === CHECK_ID
                  ? t('The lyrics in the report (from {source}) will be marked as wrong for this song. Other lyrics found for it take their place; when there are none, the track leaves the report.', { source: checkLabel(foundPreview?.foundSource) || t('Found') })
                  : t("The lyrics from {source} will be hidden for this song, and {source} won't be offered for it again.", { source: label }))}
                embedLabel={t('Insert into report')}
                embedText={source => t('The lyrics from {source} will replace the found ones in the report. Nothing is written into the file until the report is saved.', { source })}
                hidden={toolbarHidden}
                openUp={toolbarAtBottom}
                onOpenChange={onToolbarMenuChange}
              />
            ) : sources.length > 0 && (result?.source || searching) && (
              <SourceMenu
                sources={sources}
                enabled={enabledSources}
                current={result?.source || null}
                attempts={result?.attempts}
                busy={sourceBusy || !!embeddingId}
                searching={searching}
                pickingId={pickingId}
                canEmbed={hasFile}
                embeddingId={embeddingId}
                onEmbed={embedSource}
                onPick={pickSource}
                onRefresh={() => load({ refresh: true }, lines.length > 0)}
                onSearch={requestSearch}
                rejected={rejected}
                onReject={rejectSource}
                hidden={toolbarHidden}
                openUp={toolbarAtBottom}
                onOpenChange={onToolbarMenuChange}
              />
            )}
          </div>
          </div>
        </ToolbarLarge.Provider>,
        toolbarTarget,
      )}
      {showToolbar && !toolbarTarget && (
        <div
          // The pills fade by themselves (TOOLBAR_FADE), not this row: glass
          // inside a fading parent shows as flat grey until the fade ends.
          data-hidden={toolbarFaded}
          onPointerEnter={toolbarAtBottom ? () => setToolbarHover(true) : undefined}
          onPointerLeave={toolbarAtBottom ? () => setToolbarHover(false) : undefined}
          onFocus={toolbarAtBottom ? () => setToolbarHover(true) : undefined}
          onBlur={toolbarAtBottom ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setToolbarHover(false) } : undefined}
          className={toolbarAtBottom
            ? 'group/toolbar absolute bottom-0 inset-x-0 z-20 flex items-center gap-1.5 px-4 pt-4 pb-3'
            : `group/toolbar absolute top-0 inset-x-0 z-20 flex items-center gap-1.5 pl-4 ${toolbarEndGap ? 'pr-12' : 'pr-4'} pt-3 pointer-events-none ${fullscreen ? '' : 'pb-6'}`}
          // The sidebar keeps its soft shade behind the buttons; the fullscreen
          // views already have their own header there, so they go without.
          style={fullscreen || toolbarAtBottom ? undefined : { background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)' }}
        >
          <div className={`flex flex-shrink-0 items-center gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'} ${lines.length ? '' : 'invisible'}`} inert={toolbarHidden || !lines.length}>
            {sizeControl && <SizePill onOpenChange={setSizeOpen} openUp={toolbarAtBottom} />}
            <Pill active={wantTranslation} onClick={() => toggleSub('translation')} title={t('Show translation ({language})', { language: translateTarget })}>
              {translationBusy ? <Loader2 size={11} className="animate-spin" /> : <Languages size={11} />}
              {t('Translate')}
            </Pill>
            {canRomanize && (
              <Pill active={subline === 'romanization'} onClick={() => toggleSub('romanization')} title={t('Show pronunciation in Latin letters')}>
                {romanizationBusy ? <Loader2 size={11} className="animate-spin" /> : <span className="font-semibold leading-none">Aa</span>}
                {t('Romanize')}
              </Pill>
            )}
          </div>
          <div className="flex-1" />
          <div className={`flex min-w-0 items-center justify-end gap-1.5 ${toolbarHidden ? 'pointer-events-none' : 'pointer-events-auto'}`} inert={toolbarHidden}>
            {previewResult && (
              // Lyrics Search's Check: says what this is, beside the source menu.
              <span
                className={`flex flex-shrink-0 items-center gap-1 px-2.5 py-1 rounded-full text-[11px] text-accent bg-white/[0.08] backdrop-blur-md ${TOOLBAR_FADE}`}
                title={t('Lyrics found by Lyrics Search, not saved anywhere yet')}
              >
                <ScanSearch size={11} className="flex-shrink-0" />
                <span className="whitespace-nowrap">{t('Checking lyrics')}</span>
              </span>
            )}
            {previewResult ? (
              <SourceMenu
                sources={[{ id: CHECK_ID, label: t('Found') }, ...sources.filter(s => s.id !== 'local')]}
                enabled={enabledSources}
                current={picked?.id || CHECK_ID}
                attempts={{ ...(checkAttempts.trackId === track?.id ? checkAttempts.attempts : {}), [CHECK_ID]: foundPreview?.instrumental ? 'instrumental' : foundPreview?.sync }}
                busy={!!checkPickingId || !!checkInserting}
                searching={checkSearching}
                pickingId={checkPickingId}
                canEmbed
                embeddingId={checkInserting}
                onEmbed={checkInsert}
                onPick={checkPickSource}
                onRefresh={checkSearchAll}
                fixedIds={[CHECK_ID]}
                rejected={rejected}
                onReject={checkReject}
                rejectFixed
                rejectText={(label, id) => (id === CHECK_ID
                  ? t('The lyrics in the report (from {source}) will be marked as wrong for this song. Other lyrics found for it take their place; when there are none, the track leaves the report.', { source: checkLabel(foundPreview?.foundSource) || t('Found') })
                  : t("The lyrics from {source} will be hidden for this song, and {source} won't be offered for it again.", { source: label }))}
                embedLabel={t('Insert into report')}
                embedText={source => t('The lyrics from {source} will replace the found ones in the report. Nothing is written into the file until the report is saved.', { source })}
                hidden={toolbarHidden}
                openUp={toolbarAtBottom}
              />
            ) : sources.length > 0 && (result?.source || searching) && (
              <SourceMenu
                sources={sources}
                enabled={enabledSources}
                current={result?.source || null}
                attempts={result?.attempts}
                busy={sourceBusy || !!embeddingId}
                searching={searching}
                pickingId={pickingId}
                canEmbed={hasFile}
                embeddingId={embeddingId}
                onEmbed={embedSource}
                onPick={pickSource}
                onRefresh={() => load({ refresh: true }, lines.length > 0)}
                onSearch={requestSearch}
                rejected={rejected}
                onReject={rejectSource}
                hidden={toolbarHidden}
                openUp={toolbarAtBottom}
              />
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {(notice || (wantTranslation && translationState === 'same-language') || (wantTranslation && translationState === 'unavailable') || (subline === 'romanization' && romanizationState === 'unavailable')) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            // Right-aligned under the source menu (that's what it answers), and
            // allowed to wrap: a fixed-width, centred pill overflowed the narrow
            // sidebar, and framer's own transform overrode the centring.
            className={`absolute ${toolbarAtBottom ? 'bottom-12' : 'top-11'} right-4 z-30 max-w-[calc(100%-2rem)] w-max px-3 py-1.5 rounded-2xl bg-black/75 backdrop-blur-md border border-white/10 text-[11px] leading-snug text-white/85 text-right`}
          >
            {notice || (translationState === 'same-language' ? t('Already in your language') : translationState === 'unavailable' && wantTranslation ? t('Translation unavailable right now') : t('Romanization unavailable right now'))}
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={containerRef}
        onWheel={startBrowsing}
        onTouchMove={startBrowsing}
        onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key)) startBrowsing() }}
        className="w-full h-full overflow-y-auto overflow-x-hidden"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          // The sidebar has no empty space after the last line, so its closing
          // lines light up near the bottom edge -- keep the fade there short
          // enough not to dim them.
          maskImage: edgeFade ? `linear-gradient(to bottom, transparent 0, black 9%, black ${fullscreen ? 82 : 94}%, transparent 100%)` : undefined,
          WebkitMaskImage: edgeFade ? `linear-gradient(to bottom, transparent 0, black 9%, black ${fullscreen ? 82 : 94}%, transparent 100%)` : undefined,
        }}
      >
        <div className={`w-full ${fullscreen ? 'max-w-3xl mx-auto px-6' : 'px-3'}`}>
          {loading && !idleVisual && <div style={fullscreen ? FULLSCREEN_TOP : { height: '18%' }} />}
          {loading && !idleVisual && <Loading />}

          {!loading && !lines.length && !idleVisual && (
            <div className="h-full min-h-[240px] flex flex-col items-center justify-center gap-3 text-white/35 select-none pt-24">
              <Mic2 size={fullscreen ? 40 : 28} />
              {instrumental ? (
                <p className={fullscreen ? 'text-sm' : 'text-xs'}>{t('Instrumental — nothing to sing along to.')}</p>
              ) : unfound ? (
                <p className={`${fullscreen ? 'text-sm' : 'text-xs'} text-center`}>{noLyricsNote}</p>
              ) : !isOnline ? (
                <p className={fullscreen ? 'text-sm' : 'text-xs'}>{t("You're offline. Lyrics will load once you're back online.")}</p>
              ) : (
                <>
                  <p className={fullscreen ? 'text-sm' : 'text-xs'}>{t('No lyrics found')}</p>
                  <div className="flex items-center gap-3">
                    <button onClick={requestSearch} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors">
                      <Search size={12} /> {t('Search manually')}
                    </button>
                    <button onClick={() => load({ refresh: true })} className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors">
                      <RotateCcw size={12} /> {t('Try again')}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {!loading && lines.length > 0 && (
            <motion.div initial={idleVisual ? { opacity: 0, y: 8 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
              <div style={fullscreen ? FULLSCREEN_TOP : { height: synced || isAutoSynced ? '20px' : '1rem', minHeight: synced || isAutoSynced ? '1rem' : undefined }} />
              {/* The side panel goes without these notes (full screen keeps them). */}
              {!synced && fullscreen && (
                <p className="px-3 pb-3 text-[11px] text-white/35">{isAutoSynced ? t("These lyrics aren't time-synced — following along roughly.") : t("These lyrics aren't time-synced.")}</p>
              )}
              {lines.map((line, i) => (
                <Row
                  key={i}
                  line={line}
                  index={i}
                  until={nextTimes[i]}
                  clock={now}
                  distance={focusIdx >= 0 ? Math.abs(i - focusIdx) : i + 1}
                  isFocused={i === focusIdx}
                  isNext={focusIdx >= 0 && i === nextLineIdx}
                  isLive={liveSet.has(i)}
                  synced={synced}
                  browsing={browsing}
                  wordSync={wordSync}
                  fullscreen={fullscreen}
                  textScale={textScale}
                  duet={!!result?.duet}
                  sub={subLines?.[i] || null}
                  onSeek={seek}
                  registerRow={registerRow}
                />
              ))}
              <div style={{ height: fullscreen ? '55vh' : 0 }} />
              {sourceLabel && fullscreen && (
                <p className="px-3 pb-10 text-[11px] text-white/30">
                  {t('Lyrics via {source}', { source: sourceLabel })}{result?.sync ? ` · ${SYNC_LABEL[result.sync] ? t(SYNC_LABEL[result.sync]) : ''}` : ''}
                  {translationFrom ? ` · ${translationFrom === 'source' ? t('Apple Music translation') : t('Translated to {language}', { language: translateTarget })}` : ''}
                  {attribution?.provider && <span className="block mt-1">{t('Provided by {provider}', { provider: attribution.provider })}</span>}
                  {hasContributors && (
                    <span className="block mt-1">
                      {attribution.uploader && <>{t('Uploaded by')} <a href={attribution.uploader.url} target="_blank" rel="noreferrer" className="hover:text-white/60 underline underline-offset-2">{attribution.uploader.name}</a></>}
                      {attribution.uploader && attribution.maker && ' · '}
                      {attribution.maker && <>{t('made by')} <a href={attribution.maker.url} target="_blank" rel="noreferrer" className="hover:text-white/60 underline underline-offset-2">{attribution.maker.name}</a></>}
                    </span>
                  )}
                </p>
              )}
            </motion.div>
          )}
        </div>
      </div>

      {/* An instrumental (or a song whose words can't be found), over the side
          panel's visualization: just a small
          note in the bottom left corner, saying so on hover. As far from the
          panel's left edge as from what's below it: the window's bottom, or the
          floating player bar's top (92px high, 12px up: 104px of the 114px
          --player-space the side panel leaves for it). */}
      <AnimatePresence>
        {idleVisual && idle && noLyricsNote && (
          <motion.div
            key="instrumental"
            initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="group/note pointer-events-auto absolute left-2.5 z-30"
            style={{ bottom: 'calc(0.625rem - max(0px, var(--player-space, 0px) - 104px))' }}
          >
            <div tabIndex={0} aria-label={noLyricsNote}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] bg-black/30 text-white/35 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white focus-visible:bg-black/60 focus-visible:text-white outline-none">
              <Music size={14} />
            </div>
            <div role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 mb-2 w-max max-w-[14rem] rounded-xl border border-white/10 bg-black/80 px-3 py-1.5 text-[11px] leading-snug text-white/80 opacity-0 backdrop-blur-md transition-opacity duration-150 group-hover/note:opacity-100 group-focus-within/note:opacity-100">
              {noLyricsNote}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* No lyrics, over the side panel's visualization: one small line by the
          bottom edge (as low as the instrumental note above), in the panel's
          grey, see-through until the mouse is over it. */}
      <AnimatePresence>
        {idleVisual && !loading && !lines.length && !noLyricsNote && (
          <motion.div
            key="no-lyrics"
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="absolute inset-x-2.5 z-30 flex justify-center"
            style={{ bottom: 'calc(0.625rem - max(0px, var(--player-space, 0px) - 104px))' }}
          >
            <div className="pointer-events-auto flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/80 opacity-60 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100"
              style={{ backgroundColor: 'rgb(var(--surface-rgb))' }}>
              <span className="truncate">{!isOnline ? t("You're offline. Lyrics will load once you're back online.") : t('No lyrics found')}</span>
              {isOnline && (
                <>
                  <span className="text-white/40">—</span>
                  <button onClick={requestSearch} className="flex items-center gap-1 text-white hover:text-white/70 transition-colors">
                    <Search size={11} /> {t('Search manually')}
                  </button>
                  <button onClick={() => load({ refresh: true })} className="flex items-center gap-1 text-white hover:text-white/70 transition-colors">
                    <RotateCcw size={11} /> {t('Try again')}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {searchOpen && track && (
          <LyricsSearchDrawer track={track} variant={fullscreen ? 'side' : 'fill'} onClose={() => setSearchOpen(false)} onSelect={pickSearchResult} />
        )}
      </AnimatePresence>
    </div>
  )
}
