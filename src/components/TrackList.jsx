import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Pause, Heart, Plus, Camera, Trash2, Music, LibraryBig, Clock, ListEnd, GripVertical, X, Check, Edit2, Search, Download, AlertCircle, Gem, Disc3, User, ListMinus, Globe, Radio, ChevronUp, ChevronDown, FolderOpen, ExternalLink, Link2, Clapperboard } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { showToast, showLoadingToast } from './Toaster'
import { canGetLossless, openLossless, formatLabel, isSuspect, tierOf, TIERS } from '../quality'
import { usePlayerStore, useAppStore } from '../store/player'
import { useShallow } from 'zustand/react/shallow'
import { api, peekSettings } from '../api'
import TrackEditModal from './TrackEditModal'
import BatchEditModal from './BatchEditModal'
import Modal from './Modal'
import { trackArtURL, isPlayable, isStreamed, streamRef, loadAddonNames, isAddonProvider, saveTracksToLibrary, libraryDownloadMessage, missingTrackCanRedownload } from '../onlineTracks'
import SaveToLibraryButton from './SaveToLibraryButton'
// One shared list and limit (15) for recent items (see src/searchHistory.js).
import { saveRecentItem, recentTrackItem } from '../searchHistory'
import { plural } from '../plural'
import ContextMenu, { useContextMenu } from './ContextMenu'
import SelectionBar from './SelectionBar'
import DeleteTracksDialog from './DeleteTracksDialog'
import { useSelection } from '../selection'
import { addToPlaylistMany, addToQueueMany, libraryTracks, playNextMany } from '../trackActions'
import { trackColumnLayout, trackColumnPreferences, TRACK_COLUMN_DEFS, MAX_FIXED_WIDTH } from '../trackColumns'
import { useTrackColumnsStore } from '../store/trackColumns'
import { TRACK_CHANGED, readTrack, announceTrackChanged } from '../trackChanged'
import TrackColumnPicker from './TrackColumnPicker'
import { TrackSourceIcon } from './SourceIcon'
import { openRadio } from '../radioActions'
import DiscoveryImage from './DiscoveryImage'
import { playRecommendationPool } from '../recommendationPlayback'
import { playbackFallbackMessage } from '../recommendations'
import { navigateToTrackAlbum } from '../playbackContext'
import { downloadGhostResult as queueGhostResult, ghostDownloadSuggestions, redownloadMissingTrack } from '../ghostDownloads'
import HoverScrollTitle from './HoverScrollTitle'
import { useGhostDownloadSources } from './useGhostDownloadSources'
import { useGhostDurationConfirmation } from './useGhostDurationConfirmation'
import { nextPlaylistSort } from '../playlistSorting'
import { useTranslation, translate } from '../i18n'
import ExplicitBadge from './ExplicitBadge'
import { genreText } from '../genres'
import ArtistNames from './ArtistNames'
import GenrePopover from './GenrePopover'
import { useAppearanceFlag, useAppearanceValue } from '../appearanceFlags'
import { TRACK_SEARCH_SITES, clipLink, clipText, commentLink, openLink, trackSearchText, trackSearchUrl } from '../trackLinks'

const LARGE_LIST_STEP = 200
// Large lists are windowed: only the rows near the viewport are mounted, with
// fixed-height spacers standing in for everything above and below so the
// scroll height (and scrollbar) still reflect the full list. Rows are a fixed
// height, measured from the DOM once one renders; this is only the value used
// before that first measurement (text-sm + text-xs lines = 36px, plus py-1.5).
const DEFAULT_ROW_HEIGHT = 48

// The scanner files a song with no album tag under "Unknown Album": shown as
// nothing, like a missing album.
const albumName = track => {
  const album = String(track?.album || '').trim()
  return album.toLowerCase() === 'unknown album' ? '' : album
}
// Rows kept mounted on each side of the visible band. The window is only
// recomputed once the visible band gets within half of this of an edge, so
// ordinary scrolling re-renders every ~50 rows rather than on every frame.
const WINDOW_OVERSCAN = 100

// The album under a song's title or in its column: opens that album.
function AlbumLink({ track, navigate }) {
  const name = albumName(track)
  if (!name) return null
  return (
    <button type="button" className="inline transition-colors hover:text-white hover:underline"
      onClick={e => { e.stopPropagation(); navigateToTrackAlbum(navigate, track) }}
      onDoubleClick={e => e.stopPropagation()}>
      {name}
    </button>
  )
}

function getScrollParent(node) {
  let el = node?.parentElement
  while (el && el !== document.body && el !== document.documentElement) {
    const { overflowY } = window.getComputedStyle(el)
    if (/(auto|scroll|overlay)/.test(overflowY)) return el
    el = el.parentElement
  }
  return null // the document itself scrolls
}

function saveRecentTrack(track) {
  saveRecentItem(recentTrackItem(track))
}

function fmt(s) { return s ? `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}` : '' }

// Library timestamps are seconds; playlist membership timestamps are ms.
function addedDate(ts) { return new Date(Number(ts) < 1e12 ? Number(ts) * 1000 : Number(ts)) }

function fmtAddedAt(ts) {
  if (!ts) return ''
  const date = addedDate(ts)
  const now = new Date()
  const diffMs = now - date
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return translate('Today')
  if (diffDays === 1) return translate('Yesterday')
  if (diffDays < 7) return translate('{n}d ago', { n: diffDays })
  return date.toLocaleDateString()
}

function SortableHeader({ column, label, children, sort, onSortChange, className = '' }) {
  const { t } = useTranslation()
  if (!onSortChange) return <span className={className}>{children}</span>
  const active = sort?.column === column
  const next = nextPlaylistSort(sort, column)
  const direction = next.direction === 'asc' ? 'ascending' : 'descending'
  const Arrow = sort?.direction === 'desc' ? ChevronDown : ChevronUp
  const sortLabel = t('Sort by {column} {direction}', { column: t(label), direction: t(direction) })
  return <button type="button" aria-label={sortLabel} aria-pressed={active}
    title={sortLabel} data-sort-column={column} data-sort-direction={active ? sort.direction : undefined}
    onClick={event => { event.stopPropagation(); onSortChange(next) }}
    className={`flex min-w-0 items-center gap-1 rounded uppercase hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${active ? 'text-accent' : ''} ${className}`}>
    <span className="truncate">{children}</span>{active && <Arrow size={11} className="shrink-0" aria-hidden="true" />}
  </button>
}

const GRAB_HOLD_MS = 1500
// The hold's progress bar shows only after this, so a plain click (or a
// short press) doesn't flash it.
const GRAB_BAR_DELAY_MS = 1000

export default function TrackList({ tracks = [], showQuality = false, onRemove = null, showPlayNext = true, showAddToQueue = true, playlistId = null, onReorder = null, onQuickAdd = null, reduceMotion = false, context = null, highlightTrackId = null, highlightRequestKey = null, highlightQuiet = false, extraColumns = [], resolveTracks = null, sort = null, onSortChange = null, trackNumbers = null, toolbarStart = null, toolbarEnd = null, reorderable = false, onGrab = null, stickyBleed = '0.5rem' }) {
  const { t } = useTranslation()
  const resolvedPlaybackRef = useRef(0)
  const resolvedToastRef = useRef(null)
  useEffect(() => () => { resolvedPlaybackRef.current++; resolvedToastRef.current?.close() }, [])
  // Downloads from an addon are tagged with its name.
  const [addonNames, setAddonNames] = useState({})
  const hasAddonDownloads = tracks.some(t => isAddonProvider(t?.download_source) || isAddonProvider(streamRef(t)?.provider))
  useEffect(() => {
    if (!hasAddonDownloads) return undefined
    let live = true
    loadAddonNames().then(names => { if (live) setAddonNames(names) })
    return () => { live = false }
  }, [hasAddonDownloads])
  const { currentTrack, isPlaying, playTrack, togglePlay, likedIds, setLiked, playNext, addToQueue, syncTrack, syncTracks } = usePlayerStore(useShallow(({ currentTrack, isPlaying, playTrack, togglePlay, likedIds, setLiked, playNext, addToQueue, syncTrack, syncTracks }) => ({ currentTrack, isPlaying, playTrack, togglePlay, likedIds, setLiked, playNext, addToQueue, syncTrack, syncTracks })))
  const { user, openAddToPlaylist, openAddMultipleToPlaylist } = useAppStore()
  const profile = String(user?.id || 'guest')
  const savedColumns = useTrackColumnsStore(state => state.profiles[profile])
  const setColumn = useTrackColumnsStore(state => state.setColumn)
  const resetColumns = useTrackColumnsStore(state => state.resetColumns)
  const columns = trackColumnPreferences(savedColumns, showQuality, !!playlistId || !!onSortChange)
  const listRef = useRef(null)
  const [listWidth, setListWidth] = useState(0)
  useLayoutEffect(() => {
    const node = listRef.current
    const measure = () => setListWidth(node.clientWidth / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    const themeObserver = new MutationObserver(measure)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] })
    return () => { observer.disconnect(); themeObserver.disconnect() }
  }, [])
  const [hoveredId, setHoveredId] = useState(null)
  const [likeAnim, setLikeAnim] = useState(null)
  const [quickAddAnim, setQuickAddAnim] = useState(null)
  const [draggedId, setDraggedId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)
  const [editingTrack, setEditingTrack] = useState(null)
  // The genre cell being edited in place: { track, anchor } (see GenrePopover).
  const [genreEdit, setGenreEdit] = useState(null)
  const closeGenreEdit = useCallback(() => setGenreEdit(null), [])
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  // { tracks, title? }: the Delete from Library confirmation.
  const [deleteRequest, setDeleteRequest] = useState(null)
  const [trackOverrides, setTrackOverrides] = useState({})
  // [start, end) slice of mergedTracks currently mounted (large lists only).
  const [windowRange, setWindowRange] = useState({ start: 0, end: LARGE_LIST_STEP })
  const [ghostTrack, setGhostTrack] = useState(null)
  const { confirmDuration, durationChoice, isCurrent: ghostResolverOpen } = useGhostDurationConfirmation(!!ghostTrack)
  const { source: ghostSource, sourceChoice } = useGhostDownloadSources(!!ghostTrack)
  const ghostSearchSequence = useRef(0)
  const [ghostQuery, setGhostQuery] = useState('')
  const [ghostSearchResults, setGhostSearchResults] = useState([])
  const [ghostSearchLoading, setGhostSearchLoading] = useState(false)
  const [ghostLocalResults, setGhostLocalResults] = useState([])
  const [ghostLocalLoading, setGhostLocalLoading] = useState(false)
  const [ghostActionStatus, setGhostActionStatus] = useState('')
  const rowsRef = useRef(null)
  // State so a new measurement re-renders the spacers and intrinsic sizes;
  // the ref mirrors it for updateWindowFromScroll, which reads it from
  // scroll events outside render.
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT)
  // contain-intrinsic-size sizes the content box, so a skipped
  // (content-visibility: auto) row is this PLUS its vertical padding.
  // Passing the full row height there made every off-screen row 12px taller
  // than a rendered one, drifting all scroll offsets below it.
  const [rowContentHeight, setRowContentHeight] = useState(DEFAULT_ROW_HEIGHT - 12)
  const rowHeightRef = useRef(DEFAULT_ROW_HEIGHT)
  const highlightRowRef = useRef(null)
  const handledHighlightRef = useRef(null)
  // { id, key } rather than a bare track id -- see the flash-timer effect
  // below for why the request key needs to be part of the state itself.
  const [flash, setFlash] = useState(null)
  const shouldAnimateRows = !reduceMotion && tracks.length <= 120
  const anyStreamed = useMemo(() => tracks.some(t => isStreamed(t)), [tracks])
  const anyLiked = useMemo(() => tracks.some(track => likedIds.has(track.id)), [tracks, likedIds])
  const actionSlots = (showPlayNext ? 1 : 0) + (anyStreamed || resolveTracks ? 1 : 0) + (showAddToQueue ? 1 : 0) + (onQuickAdd ? 1 : 0) + 4
  // Rows can be dragged into a new order in a playlist, or wherever the page
  // asks for it (`reorderable`: Library's "Reorder").
  const canDrag = (!!playlistId || reorderable) && !!onReorder
  const layout = trackColumnLayout(listWidth, columns, { playlist: canDrag, actionSlots, likedTrack: anyLiked, extraColumns })
  const extraByKey = Object.fromEntries(extraColumns.map(column => [column.key, column]))
  // Row size (Columns menu) scales everything in a row (each cell is zoomed,
  // see [data-track-row] in index.css); Row spacing is the space around it.
  const rowPadding = `${columns.rowGap}rem`
  const artworkSize = '2rem'
  const setWidths = widths => setColumn(profile, 'widths', widths)
  const resetColumnWidth = key => {
    const { [key]: _, ...rest } = columns.widths
    setWidths(rest)
  }
  // Dragging a header edge. A fixed column takes the new width in rem; a flex
  // one (Title, Album, Genre, Comment) takes room from the other flex columns,
  // and all of them are saved as shares, so they keep their proportions when
  // the window is resized.
  const startColumnResize = (key, event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const header = event.currentTarget.closest('[data-track-header]')
    const cells = Object.fromEntries([...header.querySelectorAll('[data-col]')].map(el => [el.dataset.col, el.getBoundingClientRect().width]))
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const startX = event.clientX
    const def = TRACK_COLUMN_DEFS[key]
    const flexKeys = layout.order.filter(k => TRACK_COLUMN_DEFS[k]?.flex)
    const move = e => {
      const dx = e.clientX - startX
      if (!def?.flex) {
        const minRem = def?.min || 2
        setWidths({ ...columns.widths, [key]: Math.round(Math.min(MAX_FIXED_WIDTH, Math.max(minRem, (cells[key] + dx) / rem)) * 100) / 100 })
        return
      }
      const others = flexKeys.filter(k => k !== key)
      if (!others.length) return
      const total = flexKeys.reduce((sum, k) => sum + cells[k], 0)
      const othersStart = total - cells[key]
      const othersMin = others.reduce((sum, k) => sum + TRACK_COLUMN_DEFS[k].min * rem, 0)
      const size = Math.min(total - othersMin, Math.max(def.min * rem, cells[key] + dx))
      const scale = (total - size) / othersStart
      const next = { ...columns.widths, [key]: Math.round(size) }
      for (const k of others) next[k] = Math.round(cells[k] * scale)
      setWidths(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // A song edited elsewhere (its lyrics written from the lyrics panel...):
  // this list shows its fresh details too, whatever page it's on.
  useEffect(() => {
    const onChanged = async (e) => {
      const trackId = e.detail?.trackId
      if (trackId == null || !tracks.some(track => String(track?.id) === String(trackId))) return
      const fresh = await readTrack(trackId, { includeGhosts: true })
      if (fresh) setTrackOverrides(prev => ({ ...prev, [fresh.id]: fresh }))
    }
    window.addEventListener(TRACK_CHANGED, onChanged)
    return () => window.removeEventListener(TRACK_CHANGED, onChanged)
  }, [tracks])
  const mergedTracks = tracks.map(track => trackOverrides[track.id] ? { ...track, ...trackOverrides[track.id] } : track)
  const navigate = useNavigate()
  const glass = useAppearanceFlag('glass_player_bar')
  const glassTransparency = Math.max(0, Math.min(90, useAppearanceValue('player_bar_glass_transparency', 40)))
  const menu = useContextMenu()
  const menuId = useId()
  const trackIds = React.useMemo(() => mergedTracks.map(track => track.id), [tracks, trackOverrides]) // eslint-disable-line react-hooks/exhaustive-deps
  // Ctrl/Cmd+click selects songs, Shift+click a range (see selection.js);
  // Delete removes the selection from the playlist, or from the library in
  // other lists.
  const selection = useSelection(trackIds, {
    onDelete: (ids) => {
      const chosen = mergedTracks.filter(track => ids.includes(String(track.id)))
      if (onRemove) removeMany(chosen)
      else askDelete(chosen)
    },
  })
  const selectedIds = selection.selected
  const selectedTracks = () => mergedTracks.filter(track => selectedIds.has(String(track.id)))
  const totalTracks = mergedTracks.length
  const isLargeList = totalTracks > LARGE_LIST_STEP
  // Clamp against the current length: the stored range can outlive a list
  // that shrank (refresh, removal) until the next scroll recomputes it.
  const windowStart = isLargeList ? Math.min(windowRange.start, Math.max(0, totalTracks - 1)) : 0
  const windowEnd = isLargeList ? Math.min(Math.max(windowRange.end, windowStart + 1), totalTracks) : totalTracks
  const visibleTracks = isLargeList ? mergedTracks.slice(windowStart, windowEnd) : mergedTracks
  const topSpacerHeight = isLargeList ? windowStart * rowHeight : 0
  const bottomSpacerHeight = isLargeList ? (totalTracks - windowEnd) * rowHeight : 0

  // Recomputes the mounted window from where the list actually sits in its
  // scroll container. Being position-based (rather than "append the next
  // page when a sentinel comes into view") is what lets a scrollbar drag or
  // a jump deep into the list land on real rows instead of blank spacer.
  const updateWindowFromScroll = useCallback(() => {
    const el = rowsRef.current
    if (!el || !isLargeList) return
    const root = getScrollParent(el)
    const listTop = el.getBoundingClientRect().top
    const viewTop = root ? root.getBoundingClientRect().top : 0
    const viewBottom = root ? viewTop + root.clientHeight : window.innerHeight
    const rowHeight = rowHeightRef.current
    const first = Math.min(totalTracks, Math.max(0, Math.floor((viewTop - listTop) / rowHeight)))
    const last = Math.min(totalTracks, Math.max(first, Math.ceil((viewBottom - listTop) / rowHeight)))
    setWindowRange(prev => {
      const margin = WINDOW_OVERSCAN / 2
      const nearTop = prev.start > 0 && first - prev.start < margin
      const nearBottom = prev.end < totalTracks && prev.end - last < margin
      if (!nearTop && !nearBottom) return prev
      return {
        start: Math.max(0, first - WINDOW_OVERSCAN),
        end: Math.min(totalTracks, Math.max(last + WINDOW_OVERSCAN, LARGE_LIST_STEP)),
      }
    })
  }, [isLargeList, totalTracks])

  // Dedup key for the effect below: a caller that passes highlightRequestKey
  // (Playlist, Artist -- anywhere the same track can be re-requested by a
  // second shortcut click) gets a per-request identity even when the track
  // ID repeats, so the flash/scroll re-arms instead of silently no-op'ing
  // the second time. Callers that don't pass it (unchanged behavior) still
  // dedup on the track ID alone.
  const highlightKey = highlightRequestKey ?? highlightTrackId

  // Issue #16: when we arrive from a "playing from ..." shortcut, make sure the
  // track is actually rendered (large lists are windowed), then scroll to it
  // and flash it so it is obvious which row is playing.
  useEffect(() => {
    if (!highlightTrackId) {
      handledHighlightRef.current = null
      return
    }
    if (handledHighlightRef.current === highlightKey) return

    const index = tracks.findIndex(track => track.id === highlightTrackId)
    if (index === -1) return

    if (isLargeList && (index < windowStart || index >= windowEnd)) {
      // Mount a window centered on the target rather than every row from 0
      // up to it -- the spacer above keeps it at its true scroll offset, so
      // the scrollIntoView below lands in the right place.
      setWindowRange({
        start: Math.max(0, index - WINDOW_OVERSCAN),
        end: Math.min(tracks.length, index + WINDOW_OVERSCAN),
      })
      return // re-runs once the row exists
    }

    handledHighlightRef.current = highlightKey
    // highlightQuiet: just bring the row to the middle, at once, no flash
    // (the folder reopened at launch on the song that was playing).
    if (!highlightQuiet) setFlash({ id: highlightTrackId, key: highlightKey })

    const node = highlightRowRef.current
    if (node) {
      // rAF so the row has been laid out before we scroll to it.
      requestAnimationFrame(() => {
        try {
          node.scrollIntoView({ behavior: highlightQuiet ? 'auto' : 'smooth', block: 'center' })
        } catch {
          node.scrollIntoView()
        }
      })
    }
  }, [highlightTrackId, highlightKey, highlightQuiet, tracks, isLargeList, windowStart, windowEnd])

  // Kept separate so re-renders of the list can't cancel the flash timer.
  // Depending on the whole { id, key } object (not just the track id) matters
  // for a repeated highlight request on the SAME track while it's still
  // flashing: setFlash({ id, key }) above always creates a new object, even
  // when id is unchanged, because key (the request key) differs. That object
  // identity change is what restarts this timer for a full fresh 2 seconds --
  // depending on flash.id alone wouldn't change on a repeat, so the original
  // timer would keep running and could clear the second flash early.
  useEffect(() => {
    if (!flash) return
    const timer = setTimeout(() => setFlash(null), 2000)
    return () => clearTimeout(timer)
  }, [flash])

  // Measure the real row height once rows exist, so spacer math matches the
  // layout even if row styling changes. Once only: a transient state like
  // the drag-over border would otherwise skew every spacer mid-drag.
  const rowHeightMeasuredRef = useRef(false)
  useEffect(() => { rowHeightMeasuredRef.current = false }, [columns.rowSize, columns.rowGap])
  useEffect(() => {
    if (!isLargeList || rowHeightMeasuredRef.current || draggedId || !rowsRef.current) return
    // Only a row inside the viewport is guaranteed to be actually rendered;
    // an off-screen one reports its placeholder size instead.
    const root = getScrollParent(rowsRef.current)
    const viewTop = root ? root.getBoundingClientRect().top : 0
    const viewBottom = root ? viewTop + root.clientHeight : window.innerHeight
    const row = Array.from(rowsRef.current.querySelectorAll('[data-track-row]')).find((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= viewTop && r.bottom <= viewBottom
    })
    const h = row?.offsetHeight
    if (!h) return
    rowHeightMeasuredRef.current = true
    const cs = window.getComputedStyle(row)
    const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, k) => sum + (parseFloat(cs[k]) || 0), 0)
    setRowContentHeight(Math.max(0, h - chrome))
    if (Math.abs(h - rowHeightRef.current) > 0.5) {
      rowHeightRef.current = h
      setRowHeight(h)
      updateWindowFromScroll()
    }
  })

  useEffect(() => {
    if (!isLargeList || !rowsRef.current) return
    const root = getScrollParent(rowsRef.current)
    const target = root || window
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        updateWindowFromScroll()
      })
    }
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // Sync to the current position on mount and whenever the list length
    // changes -- unless a highlight is still pending, whose effect above owns
    // the window until it has scrolled its row into view.
    if (!highlightTrackId || handledHighlightRef.current === highlightKey) {
      updateWindowFromScroll()
    }
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
    // highlight deps intentionally omitted: only re-subscribe when the list
    // itself changes, not on every highlight request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLargeList, updateWindowFromScroll])

  useEffect(() => {
    if (!ghostTrack || !ghostSource) {
      setGhostQuery('')
      setGhostSearchResults([])
      setGhostSearchLoading(false)
      setGhostLocalResults([])
      setGhostLocalLoading(false)
      setGhostActionStatus('')
      return
    }
    const sequence = ++ghostSearchSequence.current
    const run = async () => {
      setGhostSearchResults([])
      setGhostSearchLoading(true)
      setGhostLocalLoading(true)
      setGhostActionStatus('')
      try {
        const query = [ghostTrack.artist, ghostTrack.title].filter(Boolean).join(' ')
        setGhostQuery(query)
        const result = await ghostDownloadSuggestions(query, ghostSource)
        if (sequence !== ghostSearchSequence.current) return
        setGhostSearchResults(Array.isArray(result?.results) ? result.results.slice(0, 6) : Array.isArray(result) ? result.slice(0, 6) : [])
        const localResult = await api.searchTracks(ghostTrack.title)
        if (sequence !== ghostSearchSequence.current) return
        setGhostLocalResults(Array.isArray(localResult?.tracks) ? localResult.tracks.slice(0, 8) : [])
      } catch (e) {
        if (sequence !== ghostSearchSequence.current) return
        setGhostActionStatus(t('Search failed: {error}', { error: e.message }))
      } finally {
        if (sequence !== ghostSearchSequence.current) return
        setGhostSearchLoading(false)
        setGhostLocalLoading(false)
      }
    }
    run()
    return () => { ghostSearchSequence.current++ }
  }, [ghostTrack, ghostSource])

  const refreshGhostMatches = async (queryOverride = '') => {
    const query = String(queryOverride || ghostQuery || ghostTrack?.title || '').trim()
    if (!query) {
      setGhostActionStatus(t('Enter a search query first.'))
      return
    }
    const sequence = ++ghostSearchSequence.current
    setGhostSearchResults([])
    setGhostSearchLoading(true)
    setGhostLocalLoading(true)
    setGhostActionStatus('')
    try {
      const result = await ghostDownloadSuggestions(query, ghostSource)
      if (sequence !== ghostSearchSequence.current) return
      setGhostSearchResults(Array.isArray(result?.results) ? result.results.slice(0, 6) : Array.isArray(result) ? result.slice(0, 6) : [])
      const localResult = await api.searchTracks(query)
      if (sequence !== ghostSearchSequence.current) return
      setGhostLocalResults(Array.isArray(localResult?.tracks) ? localResult.tracks.slice(0, 8) : [])
    } catch (e) {
      if (sequence !== ghostSearchSequence.current) return
      setGhostActionStatus(t('Search failed: {error}', { error: e.message }))
    } finally {
      if (sequence !== ghostSearchSequence.current) return
      setGhostSearchLoading(false)
      setGhostLocalLoading(false)
    }
  }

  // A ghost that can't be played (no file, no stream): opens the resolve dialog.
  // Online songs are ghosts too, but they stream, so they play like any track.
  const isGhostTrack = (track) => !track?.file_path || !isPlayable(track)
  const needsResolution = track => !!resolveTracks && isGhostTrack(track)
  const runResolved = async (list, action, selectedTrack) => {
    const toast = resolveTracks ? showLoadingToast(t('Finding the selected songs…')) : null
    try {
      const rows = resolveTracks ? await resolveTracks(list, { selectedTrack, onProgress: message => toast.update(message), onProviderFailure: failure => toast.update(playbackFallbackMessage(failure)) }) : list
      if (!rows.length) { toast?.close(t('No playable matches were found.')); return }
      toast?.close()
      return await action(rows)
    } catch { if (toast) toast.close(t('Could not resolve the selected tracks.')); else showToast(t('Could not resolve the selected tracks.')) }
  }

  const playResolved = (list, selected) => {
    const request = ++resolvedPlaybackRef.current
    const isCurrent = () => request === resolvedPlaybackRef.current
    resolvedToastRef.current?.close()
    const toast = showLoadingToast(selected ? t('Finding “{title}”…', { title: selected.title }) : t('Loading the selected songs…'))
    resolvedToastRef.current = toast
    let detail = ''
    return playRecommendationPool(list, {
      selected, firstPlayable: !selected, context, resolve: resolveTracks, isCurrent,
      onProgress: message => { if (isCurrent()) toast.update(message) },
      onProviderFailure: failure => { if (isCurrent()) { detail = failure.detail || detail; toast.update(playbackFallbackMessage(failure)) } },
    }).then(started => {
      toast.close(started === false && isCurrent() ? detail || t('No playable matches were found in this list.') : '')
    }).catch(() => { toast.close(isCurrent() ? t('Could not resolve the selected tracks.') : '') })
      .finally(() => { if (isCurrent()) resolvedToastRef.current = null })
  }

  const handlePlay = (track, e) => {
    e.stopPropagation()
    if (track?.missing) {
      setGhostTrack(track)
      return
    }
    if (resolveTracks) {
      if (currentTrack?.id === track.id) togglePlay()
      else playResolved(mergedTracks, track)
      return
    }
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    saveRecentTrack(track)
    if (currentTrack?.id === track.id) togglePlay()
    else playTrack(track, mergedTracks, context)
  }

  const toggleLike = async (track, e) => {
    e.stopPropagation()
    if (needsResolution(track)) return runResolved([track], rows => toggleLike(rows[0], { stopPropagation() {} }))
    const r = await api.toggleLike(track.id, user?.id, track)
    const liked = typeof r === 'boolean' ? r : r?.liked ?? false
    setLiked(track.id, liked)
    if (liked) { setLikeAnim(track.id); setTimeout(() => setLikeAnim(null), 600) }
  }

  const replaceArtwork = async (track, e) => {
    e.stopPropagation()
    if (!api.isElectron) return
    const fp = await api.openFile([{ name: t('Images'), extensions: ['jpg','jpeg','png','webp'] }])
    if (!fp) return
    const img = new Image(); img.src = `file://${fp}`
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
      c.getContext('2d').drawImage(img, 0, 0)
      api.trackSetArtwork(track.id, c.toDataURL('image/jpeg', 0.85)).then((updatedTrack) => {
        if (updatedTrack?.id) {
          syncTrack(updatedTrack)
          setTrackOverrides(prev => ({ ...prev, [updatedTrack.id]: updatedTrack }))
        }
      })
    }
  }

  // Ctrl/Cmd+click (or Shift+click, a range) selects; a plain click anywhere
  // on the row plays the song, or pauses/resumes it if it's the one playing.
  // onGrab: holding a row still for GRAB_HOLD_MS picks the song up (to drop
  // it on a folder in the sidebar); a bar along the row fills meanwhile.
  const [holdId, setHoldId] = useState(null)
  const holdRef = useRef(null)
  const grabbedClickRef = useRef(false)
  const cancelHold = () => {
    if (!holdRef.current) return
    clearTimeout(holdRef.current.timer)
    clearTimeout(holdRef.current.barTimer)
    holdRef.current = null
    setHoldId(null)
  }
  const startHold = (track, e) => {
    grabbedClickRef.current = false
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.target.closest?.('button, a, input')) return
    if (isGhostTrack(track) || isStreamed(track) || track.missing) return
    cancelHold()
    const at = { x: e.clientX, y: e.clientY }
    const timer = setTimeout(() => {
      holdRef.current = null
      setHoldId(null)
      grabbedClickRef.current = true
      onGrab?.(track, at)
    }, GRAB_HOLD_MS)
    const barTimer = setTimeout(() => setHoldId(track.id), GRAB_BAR_DELAY_MS)
    holdRef.current = { timer, barTimer, at }
  }
  const moveHold = (e) => {
    const hold = holdRef.current
    if (hold && Math.hypot(e.clientX - hold.at.x, e.clientY - hold.at.y) > 6) cancelHold()
  }
  useEffect(() => () => { clearTimeout(holdRef.current?.timer); clearTimeout(holdRef.current?.barTimer) }, [])

  const handleTrackClick = (track, e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.stopPropagation()
      selection.click(track.id, e)
      return
    }
    selection.clear()
    handlePlay(track, e)
  }

  const handleContainerClick = (e) => {
    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) selection.clear()
  }

  const askDelete = (list) => {
    if (resolveTracks) return
    const deletable = libraryTracks(list)
    if (!deletable.length) { showToast(t("Streamed and imported songs aren't in your library to delete")); return }
    setDeleteRequest({ tracks: deletable, title: deletable.length === 1 ? deletable[0].title : null })
  }

  // One removal at a time: a second Delete / Remove while it runs is ignored.
  const removingRef = useRef(false)
  const removeMany = async (list) => {
    if (!onRemove || removingRef.current) return
    removingRef.current = true
    try {
      for (const track of list) await onRemove(track)
    } catch (e) {
      showToast(t("Couldn't remove: {error}", { error: e?.message || e }))
    } finally {
      removingRef.current = false
      selection.clear()
    }
  }

  const playMany = (list) => {
    if (resolveTracks) return playResolved(list)
    const playable = list.filter(track => !isGhostTrack(track))
    if (!playable.length) return
    saveRecentTrack(playable[0])
    usePlayerStore.getState().playQueue(playable, 0, context)
  }

  const resolveDownloadTrack = async track => {
    const toast = showLoadingToast(t('Finding “{title}”…', { title: track.title }))
    try {
      const [row] = await resolveTracks([track], { prepareStreams: false, onProgress: message => toast.update(message), onProviderFailure: failure => toast.update(playbackFallbackMessage(failure)) })
      toast.close(row ? '' : t('No matching source was found for this song.'))
      return row
    } catch { toast.close(t('Could not resolve this song.')); return null }
  }

  /** Download rows/selection, resolving metadata-only recommendations first. */
  const downloadSongs = async list => {
    const toast = showLoadingToast(t('Preparing downloads…'))
    try {
      const rows = resolveTracks ? await resolveTracks(list, { prepareStreams: false, onProgress: message => toast.update(message), onProviderFailure: failure => toast.update(playbackFallbackMessage(failure)) }) : list
      const result = await saveTracksToLibrary(rows, { onProgress: message => toast.update(message) })
      result.failed += list.length - rows.length
      toast.close(libraryDownloadMessage(result))
    } catch { toast.close(t('Could not download the selected songs.')) }
  }

  /**
   * The songs a row's menu acts on: the selection when the row is in it, else
   * just the row. For one song it also has what the row's buttons do (like,
   * lossless, save, quick add), so on a narrow page, where those buttons only
   * show on hover, a right click still reaches them all.
   */
  const openTrackMenu = (event, track) => {
    const ids = selection.contextSelect(track.id)
    const list = mergedTracks.filter(item => ids.includes(String(item.id)))
    const one = list.length === 1 ? list[0] : null
    const n = list.length
    const deletable = resolveTracks ? [] : libraryTracks(list)
    const oneGhost = one && (isGhostTrack(one) || one.missing)
    menu.open(event, [
      { label: one ? t('Play') : t('Play {n} songs', { n }), icon: Play, onSelect: () => (one ? handlePlay(one, { stopPropagation() {} }) : playMany(list)) },
      { label: t('Play next'), icon: Clock, onSelect: () => runResolved(list, playNextMany) },
      { label: t('Add to queue'), icon: ListEnd, onSelect: () => runResolved(list, addToQueueMany) },
       one && { label: t('Start radio'), icon: Radio, onSelect: () => openRadio(navigate, one, useAppStore.getState().user?.id) },
      one && onQuickAdd && { label: t('Add to this playlist'), icon: LibraryBig, onSelect: () => handleQuickAdd(one) },
       list.some(item => isStreamed(item) || needsResolution(item)) && { label: resolveTracks || !one ? (one ? t('Download song') : t('Download {n} songs', { n })) : t('Save to library'), icon: Download, onSelect: () => downloadSongs(list) },
       one?.missing && { label: missingTrackCanRedownload(one) ? t('Redownload missing file') : t('Find replacement for missing file'), icon: Download, onSelect: () => setGhostTrack(one) },
      { separator: true },
      one?.album && { label: t('Go to album'), icon: Disc3, onSelect: () => navigateToTrackAlbum(navigate, one) },
      !resolveTracks && (one ? { label: t('Edit info'), icon: Edit2, onSelect: () => setEditingTrack(one) } : { label: t('Edit {n} songs', { n }), icon: Edit2, onSelect: () => setShowBatchEdit(true) }),
      !resolveTracks && one && api.isElectron && { label: t('Replace artwork'), icon: Camera, onSelect: () => replaceArtwork(one, { stopPropagation() {} }) },
      one && !oneGhost && !isStreamed(one) && api.isElectron && one.file_path && { label: t('Show in Explorer'), icon: FolderOpen, onSelect: () => api.showItemInFolder(one.file_path) },
      { separator: true },
      ...(one && trackSearchText(one) ? TRACK_SEARCH_SITES.map(site => ({ label: t(site.label), icon: ExternalLink, onSelect: () => openLink(trackSearchUrl(site, one)) })) : []),
      one && commentLink(one) && { label: t('Open comment'), icon: Link2, onSelect: () => openLink(commentLink(one)) },
      one && clipLink(one) && { label: t('Open music video'), icon: Clapperboard, onSelect: () => openLink(clipLink(one)) },
      { separator: true },
      onRemove && { label: one ? t('Remove from this playlist') : t('Remove {n} songs from this playlist', { n }), icon: ListMinus, onSelect: () => removeMany(list) },
      deletable.length > 0 && { label: deletable.length > 1 ? t('Delete {n} from library', { n: deletable.length }) : t('Delete from library'), icon: Trash2, danger: true, onSelect: () => askDelete(deletable) },
    ].filter(Boolean).filter((item, index, all) => !(item.separator && (index === 0 || index === all.length - 1 || all[index - 1]?.separator))))
  }

  const handleDragStart = (e, track) => {
    if (!canDrag) {
      e.preventDefault()
      return
    }
    setDraggedId(track.id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', track.id)
    
    const tracksToDrag = selectedIds.has(String(track.id))
      ? tracks.filter(t => selectedIds.has(String(t.id))).map(t => ({ id: t.id, title: t.title, artist: t.artist }))
      : [{ id: track.id, title: track.title, artist: track.artist }]
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'tracks', tracks: tracksToDrag }))
  }

  const handleDragOver = (e, track) => {
    if (!onReorder) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== track.id) {
      setDragOverId(track.id)
    }
  }

  const handleDragLeave = () => {
    setDragOverId(null)
  }

  const handleDrop = (e, targetTrack) => {
    if (!onReorder) return
    e.preventDefault()
    setDragOverId(null)
    if (!draggedId || draggedId === targetTrack.id) {
      setDraggedId(null)
      return
    }

    let tracksToMove
    if (selectedIds.has(String(draggedId))) {
      tracksToMove = tracks.filter(t => selectedIds.has(String(t.id)))
    } else {
      const draggedTrack = tracks.find(t => t.id === draggedId)
      tracksToMove = draggedTrack ? [draggedTrack] : []
    }

    const targetIndex = tracks.findIndex(t => t.id === targetTrack.id)
    const draggedIndex = tracks.findIndex(t => t.id === draggedId)

    if (targetIndex === -1 || draggedIndex === -1) {
      setDraggedId(null)
      return
    }

    const newTracks = [...tracks]
    for (const track of tracksToMove) {
      const idx = newTracks.findIndex(t => t.id === track.id)
      if (idx !== -1) newTracks.splice(idx, 1)
    }

    let insertIndex = newTracks.findIndex(t => t.id === targetTrack.id)
    if (insertIndex === -1) insertIndex = newTracks.length

    if (draggedIndex < targetIndex) {
      insertIndex = newTracks.findIndex(t => t.id === targetTrack.id)
    }

    for (let i = tracksToMove.length - 1; i >= 0; i--) {
      newTracks.splice(insertIndex, 0, tracksToMove[i])
    }

    if (onReorder) {
      onReorder(newTracks.map(t => t.id))
    }

    setDraggedId(null)
  }

  const handleDragEnd = () => {
    setDraggedId(null)
    setDragOverId(null)
  }

  // A row's buttons act on the whole selection when the row is part of it.
  const rowTargets = (track) => (selectedIds.size > 1 && selectedIds.has(String(track.id)) ? selectedTracks() : [track])

  const handlePlayNext = (track, e) => {
    e.stopPropagation()
    if (resolveTracks) return runResolved(rowTargets(track), playNextMany)
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    playNextMany(rowTargets(track))
  }

  const handleAddToQueue = (track, e) => {
    e.stopPropagation()
    if (resolveTracks) return runResolved(rowTargets(track), addToQueueMany)
    if (isGhostTrack(track)) {
      setGhostTrack(track)
      return
    }
    addToQueueMany(rowTargets(track))
  }

  const artSrc = (t) => trackArtURL(t)

  const handleBatchSave = (updatedTracks) => {
    if (!Array.isArray(updatedTracks) || !updatedTracks.length) return
    const nextOverrides = {}
    syncTracks(updatedTracks)
    for (const updatedTrack of updatedTracks) {
      if (!updatedTrack?.id) continue
      nextOverrides[updatedTrack.id] = updatedTrack
    }
    setTrackOverrides(prev => ({ ...prev, ...nextOverrides }))
    selection.clear()
    window.dispatchEvent(new Event('lokal:refresh'))
  }

  const handleQuickAdd = async (track, e) => {
    e?.stopPropagation()
    if (!onQuickAdd) return
    
    setQuickAddAnim(track.id)
    
    await onQuickAdd(track)
    
    setTimeout(() => setQuickAddAnim(null), 600)
  }

  const downloadGhostResult = async (item) => {
    if (!item) return
    setGhostActionStatus(t('Starting download...'))
    try {
      const result = await queueGhostResult(ghostTrack, item, { confirmDuration, isCurrent: ghostResolverOpen })
      if (result?.cancelled) { setGhostActionStatus(t('Skipped.')); return }
      if (result?.error) {
        setGhostActionStatus(t('Download failed: {error}', { error: result.error }))
        return
      }
      setGhostActionStatus(result?.alreadyInLibrary ? t('Replaced with your library copy.') : t('Download started. This playlist entry will be replaced when it finishes.'))
      if (result?.alreadyInLibrary) window.dispatchEvent(new Event('lokal:refresh'))
    } catch (e) {
      setGhostActionStatus(t('Download failed: {error}', { error: e.message }))
    }
  }

  const redownloadMissing = async () => {
    if (!ghostTrack?.missing) return
    setGhostActionStatus(t('Starting redownload…'))
    const result = await redownloadMissingTrack(ghostTrack).catch(error => ({ error: error.message }))
    if (result?.error) setGhostActionStatus(t('Redownload failed: {error}', { error: result.error }))
    else setGhostActionStatus(t('Redownload started. The existing library entry will be repaired when it finishes.'))
  }

  const assignGhostTrack = async (track) => {
    if (!ghostTrack?.id || !track?.id) return
    setGhostActionStatus(t('Assigning track...'))
    try {
      const result = await api.resolveGhostTrack(ghostTrack.id, track.id)
      if (result?.error) {
        setGhostActionStatus(t('Assign failed: {error}', { error: result.error }))
        return
      }
      setGhostActionStatus(t('Assigned successfully.'))
      window.dispatchEvent(new Event('lokal:refresh'))
      if (playlistId) {
        window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId } }))
      }
      setGhostTrack(null)
    } catch (e) {
      setGhostActionStatus(t('Assign failed: {error}', { error: e.message }))
    }
  }

  return (
    <div ref={listRef} className="w-full min-w-0" style={{ '--tl-columns': layout.template }} onClick={handleContainerClick}>
      <SelectionBar
        open={selection.count > 0}
        label={t('{n} selected', { n: selection.count })}
        onClear={selection.clear}
        actions={[
          { label: t('Play'), icon: Play, onClick: () => playMany(selectedTracks()) },
          { label: t('Play next'), icon: Clock, onClick: () => runResolved(selectedTracks(), playNextMany) },
          { label: t('Add to queue'), icon: ListEnd, onClick: () => runResolved(selectedTracks(), addToQueueMany) },
          { label: t('Add to playlist'), icon: Plus, onClick: () => runResolved(selectedTracks(), addToPlaylistMany) },
          { label: t('Download'), icon: Download, onClick: () => downloadSongs(selectedTracks()), hidden: !selectedTracks().some(track => isStreamed(track) || needsResolution(track)) },
          { label: t('Edit'), icon: Edit2, onClick: () => setShowBatchEdit(true), hidden: !!resolveTracks },
          { label: t('Remove'), icon: ListMinus, onClick: () => removeMany(selectedTracks()), hidden: !onRemove },
          { label: t('Delete'), icon: Trash2, danger: true, onClick: () => askDelete(selectedTracks()), hidden: !!resolveTracks || !libraryTracks(selectedTracks()).length },
        ]}
      />

      {/* The toolbar and the column names stay in view while the list scrolls. */}
      {/* Same glass as the player bar (Settings > Appearance > Player Bar >
          Glass, Glass transparency): one setting for both. */}
      {/* stickyBleed: how far it reaches past the list on each side, so it can
          span the page's own padding (Library: the whole middle column). */}
      <div data-track-sticky className={`sticky top-0 z-20 pt-2 ${glass ? 'backdrop-blur-lg backdrop-saturate-150' : ''}`}
        style={{ marginInline: `calc(-1 * ${stickyBleed})`, paddingInline: stickyBleed, backgroundColor: glass ? `rgb(var(--surface-rgb) / ${(1 - glassTransparency / 100).toFixed(2)})` : 'rgb(var(--surface-rgb))' }}>
      <div className="mb-1 flex items-center justify-between gap-3 px-2">
        {toolbarStart || <span />}
        <div className="flex items-center gap-1">
          {toolbarEnd}
          <TrackColumnPicker columns={columns} playlist={!!playlistId}
            onChange={(key, value) => setColumn(profile, key, value)} onReset={() => resetColumns(profile)} />
        </div>
      </div>
      <div data-track-header className="grid grid-cols-[var(--tl-columns)] items-center gap-2 pl-1 pr-4 py-1.5 text-xs text-muted uppercase tracking-widest border-b border-border font-display mb-0.5">
        {layout.grip && <span />}
        {layout.order.map(key => {
          const extra = extraByKey[key]
          const cell = extra ? <span className="truncate text-right tracking-normal">{extra.label}</span>
            : key === 'number' ? <SortableHeader column="number" label="playlist number" sort={sort} onSortChange={onSortChange} className="justify-center text-center">#</SortableHeader>
            : key === 'tracknum' ? <span className="text-center" title={t('Track number')}>{t('Trk')}</span>
            : key === 'title' ? <span>{layout.album ? t('Title') : t('Title / Album')}</span>
            : key === 'album' ? <span className="truncate">{t('Album')}</span>
            : key === 'source' ? <span className="flex justify-center" title={t("Source")}><Globe size={12} aria-hidden="true" /><span className="sr-only">{t("Source")}</span></span>
            : key === 'quality' ? <span className="text-center">{t('Quality')}</span>
            : key === 'genre' ? <span className="truncate tracking-normal">{t('Genre')}</span>
            : key === 'comment' ? <span className="truncate tracking-normal">{t('Comment')}</span>
            : key === 'clip' ? <span className="truncate tracking-normal">{t('Music video')}</span>
            : key === 'lyrics' ? <span className="truncate tracking-normal">{t('Lyrics')}</span>
            : key === 'added' ? <SortableHeader column="added" label="date added" sort={sort} onSortChange={onSortChange} className="justify-end truncate text-right tracking-normal">{t('Date added')}</SortableHeader>
            : key === 'time' ? <SortableHeader column="time" label="duration" sort={sort} onSortChange={onSortChange} className="justify-end text-right">{t('Time')}</SortableHeader>
            : null
          return (
            <div key={key} data-col={key} className="relative grid min-w-0 items-center">
              {cell}
              {/* Drag the edge to resize this column (double-click: default width). */}
              <span aria-hidden="true" title={t('Drag to resize')} onPointerDown={e => startColumnResize(key, e)}
                onDoubleClick={e => { e.stopPropagation(); resetColumnWidth(key) }} onClick={e => e.stopPropagation()}
                className="absolute -right-[7px] inset-y-[-4px] z-10 w-2.5 cursor-col-resize" />
            </div>
          )
        })}
        <span className="sr-only">{t('Actions')}</span>
        <span aria-hidden="true" />
      </div>
      </div>
      {onSortChange && <span className="sr-only" role="status">{t('Sorted by {column}, {direction}', { column: t(sort?.column === 'added' ? 'date added' : sort?.column === 'time' ? 'duration' : 'playlist number'), direction: t(sort?.direction === 'desc' ? 'descending' : 'ascending') })}</span>}

      <div ref={rowsRef}>
      {topSpacerHeight > 0 && <div aria-hidden="true" style={{ height: topSpacerHeight }} />}
      {visibleTracks.map((track, i) => {
        // Position in the full list -- differs from `i` once the window
        // doesn't start at 0, and is what the row number and key must use.
        const trackIndex = windowStart + i
        const isCurrent = currentTrack?.id === track.id
        const isHighlighted = !!highlightTrackId && track.id === highlightTrackId
        const isFlashing = !!flash && track.id === flash.id
        const isHov = hoveredId === track.id
        const isSelected = selectedIds.has(String(track.id))
        const isDragging = draggedId === track.id
        const isDragOver = dragOverId === track.id
        const liked = likedIds.has(track.id)
        const src = artSrc(track)
        const isMissing = !!track.missing
        const isGhost = (isGhostTrack(track) || isMissing) && !needsResolution(track)
        const streamed = isStreamed(track)
        const RowComponent = shouldAnimateRows ? motion.div : 'div'
        const motionProps = shouldAnimateRows ? {
          initial: { opacity: 0, y: 2 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: Math.min(i * 0.01, 0.2) },
        } : {}

        return (
          <RowComponent key={`${track.id}-${trackIndex}`}
            {...motionProps}
            data-track-row
            ref={isHighlighted ? highlightRowRef : undefined}
            draggable={canDrag}
            onDragStart={(e) => handleDragStart(e, track)}
            onDragOver={(e) => handleDragOver(e, track)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, track)}
            onDragEnd={handleDragEnd}
            onMouseEnter={() => setHoveredId(track.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={(e) => { if (grabbedClickRef.current) { grabbedClickRef.current = false; e.stopPropagation(); return } handleTrackClick(track, e) }}
            onContextMenu={(e) => openTrackMenu(e, track)}
            onPointerDown={onGrab ? (e) => startHold(track, e) : undefined}
            onPointerMove={onGrab ? moveHold : undefined}
            onPointerUp={onGrab ? cancelHold : undefined}
            onPointerLeave={onGrab ? cancelHold : undefined}
            aria-selected={isSelected}
            style={{ paddingBlock: rowPadding, '--tl-row-scale': columns.rowSize, ...(isHighlighted ? null : { contentVisibility: 'auto', containIntrinsicSize: `${rowContentHeight}px` }) }}
            className={`relative grid grid-cols-[var(--tl-columns)] gap-2 pl-1 pr-4 rounded-lg items-center cursor-default group transition-colors ${isCurrent ? 'bg-accent/8' : 'hover:bg-elevated'} ${isSelected ? 'bg-accent/15' : ''} ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-t-2 border-accent' : ''} ${isGhost ? 'opacity-75' : ''} ${isFlashing ? 'ring-2 ring-accent bg-accent/15 animate-pulse' : ''}`}
          >
            {holdId === track.id && (
              // Held: fills over GRAB_HOLD_MS, then the song is picked up.
              <span aria-hidden="true" className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/10">
                <span className="block h-full origin-left rounded-full bg-accent" style={{ animation: `lokal-grab-fill ${GRAB_HOLD_MS}ms linear -${GRAB_BAR_DELAY_MS}ms forwards` }} />
              </span>
            )}
            {layout.grip && (
              <div className="flex items-center justify-center text-muted opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing">
                <GripVertical size={14} />
              </div>
            )}

            {layout.order.map(key => {
              const extra = extraByKey[key]
              if (extra) return <span key={key} data-track-column={key} className="truncate text-right text-xs text-muted">{extra.render(track)}</span>
              switch (key) {
                case 'number': return <React.Fragment key={key}><div data-track-column="number" className="flex items-center justify-center h-7 text-xs text-muted font-display">
              {isGhost ? (
                <button onClick={e => { e.stopPropagation(); setGhostTrack(track) }} className="text-yellow-300 hover:text-yellow-200 transition-colors" title={t("Ghost song")}>
                  <AlertCircle size={14} />
                </button>
              ) : isHov ? (
                <button onClick={e => handlePlay(track, e)} aria-label={t(isCurrent && isPlaying ? 'Pause {title}' : 'Play {title}', { title: track.title })} className={isCurrent ? 'text-accent' : 'text-white'}>
                  {isCurrent && isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-px" />}
                </button>
              ) : <span className={isCurrent ? 'text-accent' : ''}>{trackNumbers?.get(track.playlist_track_id ?? track.id) ?? trackIndex + 1}</span>}
            </div></React.Fragment>
                case 'title': return <React.Fragment key={key}><div className="min-w-0 flex items-center gap-2.5">
              {columns.artwork ? <div className="rounded flex-shrink-0 overflow-hidden bg-card relative" style={{ width: artworkSize, height: artworkSize }}>
                {resolveTracks ? <DiscoveryImage item={track} src={src} className="w-full h-full object-cover" /> : src ? <img src={src} className="w-full h-full object-cover" alt="" loading="lazy" decoding="async" /> : <div className="w-full h-full flex items-center justify-center text-muted"><Music size={11} /></div>}
                {!layout.number && <button onClick={e => handlePlay(track, e)} aria-label={t(isCurrent && isPlaying ? 'Pause {title}' : 'Play {title}', { title: track.title })}
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                  {isCurrent && isPlaying ? <Pause size={14} /> : <Play size={14} />}
                </button>}
              </div> : !layout.number && <button onClick={e => handlePlay(track, e)} aria-label={t(isCurrent && isPlaying ? 'Pause {title}' : 'Play {title}', { title: track.title })} className="shrink-0 text-muted hover:text-accent">
                {isCurrent && isPlaying ? <Pause size={14} /> : <Play size={14} />}
              </button>}
              <div className="min-w-0 flex-1">
                {/* Clipped at the column's edge: on a very narrow page the
                    title's minimum and its badges can't spill into the
                    next column. */}
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  {columns.source && !layout.source && <TrackSourceIcon track={track} addonNames={addonNames} />}
                  <p title={track.title} className={`min-w-0 text-sm font-medium truncate ${isCurrent ? 'text-accent' : 'text-white'}`}>{track.title}</p>
                  {!!track.explicit && <ExplicitBadge />}
                  {isMissing && <span className="px-1.5 py-0.5 rounded-full bg-red-400/10 border border-red-400/20 text-[10px] leading-[14px] uppercase tracking-wide text-red-200 flex-shrink-0">{t("Missing file")}</span>}
                  {!isMissing && isGhost && <span className="px-1.5 py-0.5 rounded-full bg-yellow-400/10 border border-yellow-400/20 text-[10px] leading-[14px] uppercase tracking-wide text-yellow-200 flex-shrink-0">{t("Ghost")}</span>}
                  {!isMissing && track.playback_error && <span title={track.playback_error} className="px-1.5 py-0.5 rounded-full bg-red-400/10 border border-red-400/20 text-[10px] leading-[14px] uppercase tracking-wide text-red-200 flex-shrink-0">{t('Can\'t play')}</span>}
                </div>
                <div className="flex min-w-0 items-center text-xs text-muted leading-4 h-4">
                  {columns.artist && <ArtistNames track={track} className="min-w-0 flex-1 truncate" linkClassName="hover:text-white hover:underline" />}
                  {!layout.album && albumName(track) && <>
                    {columns.artist && track.artist && <span className="mx-1 shrink-0">·</span>}
                    <span data-inline-album className="min-w-0 flex-1 truncate" title={albumName(track)}><AlbumLink track={track} navigate={navigate} /></span>
                  </>}
                </div>
                {extraColumns.filter(column => !layout[column.key]).map(column => <span key={column.key} className="mr-2 text-[10px] text-muted">{column.label}: {column.render(track)}</span>)}
              </div>
            </div></React.Fragment>
                case 'album': return <React.Fragment key={key}><p className="truncate text-xs text-muted" title={albumName(track) || undefined}><AlbumLink track={track} navigate={navigate} /></p></React.Fragment>
                case 'source': return <React.Fragment key={key}><span className="flex items-center justify-center"><TrackSourceIcon track={track} addonNames={addonNames} /></span></React.Fragment>
                case 'quality': return <React.Fragment key={key}>{(() => {
              // Same badge as the Audio Quality page; opens that page on its list.
              const tier = isStreamed(track) || isGhost ? 'unknown' : (isSuspect(track) ? 'suspect' : tierOf(track))
              if (tier === 'unknown') return <span title={t("Quality unknown")} className="text-center text-xs text-muted/50">—</span>
              const info = TIERS[tier]
              return (
                <button onClick={e => { e.stopPropagation(); navigate('/quality', { state: { tier } }) }}
                  title={`${t(info.label)}: ${t(info.desc)}${formatLabel(track) ? ` (${formatLabel(track)})` : ''}`}
                  className={`justify-self-center rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase leading-[14px] tracking-wide transition-opacity hover:opacity-80 ${info.className}`}>
                  {t(info.label)}
                </button>
              )
            })()}</React.Fragment>
                case 'tracknum': return <span key={key} data-track-column="tracknum" className="text-center text-xs text-muted font-display">{track.track_num || ''}</span>
                case 'genre': {
                  const genres = genreText(track)
                  // A library song's genres open a small editor next to the cell.
                  if (resolveTracks || streamed || !track.id) return <p key={key} data-track-column="genre" className="truncate text-xs text-muted" title={genres || undefined}>{genres}</p>
                  return (
                    <button key={key} type="button" data-track-column="genre" title={genres || t('Add a genre…')}
                      onClick={e => { e.stopPropagation(); setGenreEdit({ track, anchor: e.currentTarget.getBoundingClientRect() }) }}
                      onDoubleClick={e => e.stopPropagation()}
                      className={`min-w-0 truncate text-left text-xs transition-colors hover:text-white ${genres ? 'text-muted' : 'text-transparent group-hover:text-muted/50'}`}>
                      {genres || '+'}
                    </button>
                  )
                }
                case 'lyrics': return <span key={key} data-track-column="lyrics" className={`truncate text-xs font-display ${track.lyrics_kind === 'sync' ? 'text-accent/80' : 'text-muted'}`}>{['sync', 'plain', 'instrumental', 'unfound'].includes(track.lyrics_kind) ? track.lyrics_kind : ''}</span>
                case 'comment': return commentLink(track)
                  ? <button key={key} type="button" data-track-column="comment" onClick={e => { e.stopPropagation(); openLink(commentLink(track)) }} onDoubleClick={e => e.stopPropagation()}
                      title={commentLink(track)} className="min-w-0 truncate text-left text-xs text-muted hover:text-accent hover:underline">{commentLink(track)}</button>
                  : <p key={key} data-track-column="comment" className="truncate text-xs text-muted" title={track.comment || undefined}>{track.comment || ''}</p>
                case 'clip': return clipLink(track)
                  ? <button key={key} type="button" data-track-column="clip" onClick={e => { e.stopPropagation(); openLink(clipLink(track)) }} onDoubleClick={e => e.stopPropagation()}
                      title={clipText(track)} className="min-w-0 truncate text-left text-xs text-muted hover:text-accent hover:underline">{clipText(track)}</button>
                  : <span key={key} data-track-column="clip" />
                case 'added': return <React.Fragment key={key}><p data-track-column="added" className="truncate text-right text-xs text-muted/60" title={track.added_at ? addedDate(track.added_at).toLocaleString() : undefined}>{fmtAddedAt(track.added_at)}</p></React.Fragment>
                case 'time': return <React.Fragment key={key}><span data-track-column="time" className="text-xs text-muted text-right font-display">{fmt(track.duration)}</span></React.Fragment>
                default: return null
              }
            })}
            <div className="flex items-center justify-end gap-1.5">
              <div className={`${layout.actions ? 'flex' : 'hidden'} items-center justify-end gap-1.5`}>
                {showPlayNext && !isGhost && (
                  <button onClick={e => handlePlayNext(track, e)} title={t("Play next")} aria-label={t("Play next")}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                    <Clock size={14} />
                  </button>
                )}
                {(streamed || needsResolution(track)) && <SaveToLibraryButton track={track} getTrack={needsResolution(track) ? () => resolveDownloadTrack(track) : undefined} meta={track} className="opacity-0 group-hover:opacity-100 focus:opacity-100" />}
                {isMissing && <button onClick={e => { e.stopPropagation(); setGhostTrack(track) }} title={t("Redownload or find a replacement")} aria-label={t("Redownload or find a replacement")} className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-accent hover:text-white transition-all"><Download size={14} /></button>}
                {showAddToQueue && !isGhost && (
                  <button onClick={e => handleAddToQueue(track, e)} title={t("Add to queue")} aria-label={t("Add to queue")}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all">
                    <ListEnd size={14} />
                  </button>
                )}
                {onQuickAdd && (
                  <div className="relative">
                    <button onClick={e => handleQuickAdd(track, e)} title={t('Add to this playlist')} aria-label={t('Add to this playlist')}
                      className={`opacity-0 group-hover:opacity-100 transition-all ${quickAddAnim === track.id ? 'text-green-400' : 'text-muted hover:text-green-400'}`}>
                      {quickAddAnim === track.id ? <Check size={14} /> : <LibraryBig size={14} />}
                    </button>
                    <AnimatePresence>
                      {quickAddAnim === track.id && (
                        <motion.div 
                          initial={{ scale: 0.5, opacity: 1 }} 
                          animate={{ scale: 2, opacity: 0 }} 
                          exit={{}}
                          transition={{ duration: 0.4 }}
                          className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <Check size={14} className="text-green-400" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                {(() => {
                  // On every row, so the columns line up; greyed out where it can't be used.
                  const upgradable = !isGhost && canGetLossless(track)
                  const unread = track.lossless === null || track.lossless === undefined
                  const why = upgradable ? (unread ? t('Get it in lossless (quality not read yet)') : formatLabel(track) ? t('Get it in lossless (now {format})', { format: formatLabel(track) }) : t('Get it in lossless'))
                    : track.missing ? t('Get it in lossless: the file is missing')
                      : isStreamed(track) || isGhost ? t('Get it in lossless: save it to your library first')
                        : formatLabel(track) ? t('Already lossless ({format})', { format: formatLabel(track) }) : t('Already lossless')
                  return (
                    <button onClick={e => { e.stopPropagation(); if (upgradable) openLossless(track) }}
                      aria-disabled={!upgradable} title={why} aria-label={why}
                      className={`opacity-0 group-hover:opacity-100 transition-all ${upgradable ? 'text-muted hover:text-accent' : 'text-muted/30 cursor-not-allowed'}`}>
                      <Gem size={13} />
                    </button>
                  )
                })()}
                <button onClick={e => { e.stopPropagation(); runResolved([track], rows => openAddToPlaylist(rows[0])) }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                  title={t("Add to another playlist")}>
                  <Plus size={14} />
                </button>
                {!resolveTracks && <button
                  onClick={e => { e.stopPropagation(); setEditingTrack(track) }}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent transition-all"
                  title={t("Edit track info")}
                >
                  <Edit2 size={14} />
                </button>}
                {onRemove && (
                  <button onClick={e => { e.stopPropagation(); onRemove(track) }} title={t('Remove from this playlist')} aria-label={t('Remove from this playlist')}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all">
                    <Trash2 size={12} />
                  </button>
                )}
                {!playlistId && !onRemove && !resolveTracks && (
                  <button onClick={e => { e.stopPropagation(); askDelete([track]) }}
                    className="opacity-0 group-hover:opacity-100 text-muted hover:text-red-400 transition-all" title={t("Delete from Library")}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <div className={`${layout.actions || layout.likedTrack ? '' : 'hidden'} relative flex-shrink-0`}>
                <button onClick={e => toggleLike(track, e)}
                  aria-label={liked ? t('Unlike song') : t('Like song')} className={`transition-all focus:opacity-100 ${liked ? 'text-accent' : 'text-muted opacity-0 group-hover:opacity-100 hover:text-white'}`}>
                  <Heart size={13} fill={liked ? 'currentColor' : 'none'} />
                </button>
                <AnimatePresence>
                  {likeAnim === track.id && (
                    <motion.div initial={{ scale: 0.5, opacity: 1 }} animate={{ scale: 2.5, opacity: 0 }} exit={{}}
                      transition={{ duration: 0.5 }}
                      className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Heart size={13} className="text-accent" fill="currentColor" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </RowComponent>
        )
      })}

      {bottomSpacerHeight > 0 && <div aria-hidden="true" style={{ height: bottomSpacerHeight }} />}
      </div>
      
      <TrackEditModal 
        track={editingTrack} 
        open={!!editingTrack} 
        onClose={() => setEditingTrack(null)} 
        onSave={(updatedTrack) => {
          if (!updatedTrack?.id) return
          syncTrack(updatedTrack)
          setTrackOverrides(prev => ({ ...prev, [updatedTrack.id]: updatedTrack }))
          setEditingTrack(updatedTrack)
          // Only this song changed: lists read just it again (not the whole library).
          announceTrackChanged(updatedTrack.id)
        }}
      />

      {genreEdit && (
        <GenrePopover track={genreEdit.track} anchor={genreEdit.anchor}
          onClose={closeGenreEdit}
          onSaved={(updatedTrack) => {
            if (!updatedTrack?.id) return
            syncTrack(updatedTrack)
            setTrackOverrides(prev => ({ ...prev, [updatedTrack.id]: updatedTrack }))
            announceTrackChanged(updatedTrack.id)
          }}
        />
      )}

      <BatchEditModal
        tracks={selectedTracks()}
        open={showBatchEdit}
        onClose={() => setShowBatchEdit(false)}
        onSave={handleBatchSave}
      />

      <DeleteTracksDialog request={deleteRequest} onClose={() => setDeleteRequest(null)} onDone={() => selection.clear()} />
      <ContextMenu menu={menu} id={menuId} />

      <Modal
        open={!!ghostTrack}
        onClose={() => setGhostTrack(null)}
        title={t("Resolve Ghost Song")}
        width="max-w-2xl"
      >
        <div className="space-y-4">
          {durationChoice}
          <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-400/10 border border-yellow-400/20 flex items-center justify-center flex-shrink-0">
                <AlertCircle size={18} className="text-yellow-200" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-white font-medium">{ghostTrack?.title}</p>
                <p className="text-xs text-muted mt-1">{ghostTrack?.artist || t('Unknown Artist')}{ghostTrack?.album ? ` · ${ghostTrack.album}` : ''}</p>
               <p className="text-xs text-muted mt-2">{ghostTrack?.missing ? t('This library entry points to a file that is no longer on disk. Redownload it from a known source or search for a replacement; the existing library entry will be repaired.') : t('This song was imported from another platform but Lokal could not match it to a local file yet. It stays in the playlist as a placeholder until you resolve it.')}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {ghostTrack?.missing && /^((yt|sc):|a-[0-9a-f]{10}:)/.test(String(ghostTrack.source_ref || '')) && (
              <button onClick={redownloadMissing} className="px-3 py-2 rounded-lg bg-accent/15 border border-accent/25 text-accent text-sm hover:bg-accent/25 transition-colors flex items-center gap-2">
                <Download size={14} /> {t('Redownload original')}
              </button>
            )}
            <button
              onClick={() => refreshGhostMatches()}
              className="px-3 py-2 rounded-lg bg-card border border-border text-sm text-muted hover:text-white hover:border-accent/30 transition-colors flex items-center gap-2"
            >
              <Search size={14} /> {t('Refresh Matches')}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={ghostQuery}
              onChange={e => setGhostQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') refreshGhostMatches(e.currentTarget.value) }}
              placeholder={t("Search manually for a better match")}
              className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
            />
            <button
              onClick={() => refreshGhostMatches()}
              className="px-3 py-2 rounded-lg bg-accent/15 border border-accent/25 text-accent text-sm hover:bg-accent/25 transition-colors"
            >
              {t('Search')}
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted font-display">{t('Assign Existing Local Track')}</div>
            <div className="divide-y divide-border">
              {ghostLocalLoading && (
                <div className="px-4 py-6 text-sm text-muted">{t('Searching local library…')}</div>
              )}
              {!ghostLocalLoading && ghostLocalResults.map((item) => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <HoverScrollTitle title={item.title} className="text-sm text-white" />
                    <p className="text-xs text-muted truncate">{item.artist}{item.album ? ` · ${item.album}` : ''}</p>
                  </div>
                  <button
                    onClick={() => assignGhostTrack(item)}
                    className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors flex items-center gap-1.5"
                  >
                    <Check size={12} /> {t('Assign')}
                  </button>
                </div>
              ))}
              {!ghostLocalLoading && !ghostLocalResults.length && (
                <div className="px-4 py-6 text-sm text-muted">{t('No strong local matches yet. If you just downloaded the song, try Refresh Matches after indexing finishes.')}</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-xs uppercase tracking-widest text-muted font-display">{t('Suggested Downloads')}<div className="mt-2 normal-case tracking-normal">{sourceChoice}</div></div>
            <div className="divide-y divide-border">
              {ghostSearchLoading && (
                <div className="px-4 py-6 text-sm text-muted">{t('Searching…')}</div>
              )}
              {!ghostSearchLoading && ghostSearchResults.map((item) => (
                <div key={item.id || item.url} className="px-4 py-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <HoverScrollTitle title={item.title} className="text-sm text-white" />
                    <p className="text-xs text-muted truncate">{item.channel || item.artist || item.url}</p>
                  </div>
                  <button
                    onClick={() => downloadGhostResult(item)}
                    className="px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/25 text-accent text-xs hover:bg-accent/25 transition-colors flex items-center gap-1.5"
                  >
                    <Download size={12} /> {t('Download & replace')}
                  </button>
                </div>
              ))}
              {!ghostSearchLoading && !ghostSearchResults.length && (
                <div className="px-4 py-6 text-sm text-muted">{t('No suggestions yet. Try another source or search query.')}</div>
              )}
            </div>
          </div>

          {ghostActionStatus && <p className="text-xs text-muted">{ghostActionStatus}</p>}

          <div className="flex gap-2">
            <button onClick={() => setGhostTrack(null)} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors">{t('Close')}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
