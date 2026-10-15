import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownUp, ArrowLeft, Check, FolderInput, ListOrdered, Music, SlidersHorizontal, X } from 'lucide-react'
import Modal from '../components/Modal'
import { showToast } from '../components/Toaster'
import { setLibraryFolder } from '../libraryNav'
import { draftNumbers, useFolderGrab } from '../folderOrder'
import { usePlayerStore } from '../store/player'
import { useAppearanceText } from '../appearanceFlags'
import ToolbarMenu from '../components/ToolbarMenu'
import TrackList from '../components/TrackList'
import ScanBanner from '../components/ScanBanner'
import { api, peekSettings } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { useLibraryFolder } from '../libraryNav'
import { useTranslation } from '../i18n'
import { TRACK_CHANGED, readTrack, placeTrack } from '../trackChanged'

const LIBRARY_PAGE_SIZE = 50
// How the list goes from one folder's songs to the next's. While the next
// folder loads, the old list waits (faded or dimmed); once its songs are in,
// the new list comes in (a CSS animation, see .folder-in-* in index.css,
// replayed as the wrapper is keyed by the folder shown).
export const FOLDER_TRANSITIONS = [
  ['fade', 'Fade'],
  ['soft', 'Soft fade'],
  ['slide', 'Slide up'],
  ['zoom', 'Zoom'],
  ['blur', 'Blur'],
  ['none', 'No animation'],
]
function folderTransitionProps(mode, switching) {
  if (mode === 'none') return {}
  if (mode === 'fade') return { style: { opacity: switching ? 0 : 1, transition: `opacity ${switching ? 120 : 200}ms ease-out` } }
  return {
    className: switching ? '' : `folder-in-${mode}`,
    style: { opacity: switching ? 0.35 : 1, filter: switching && mode === 'blur' ? 'blur(3px)' : undefined, transition: 'opacity 160ms ease-out, filter 160ms ease-out' },
  }
}

// How long moving a song to another folder may take before it's called off.
const MOVE_TIMEOUT_MS = 5000

const fileName = filePath => String(filePath).split(/[\\/]/).pop()

// The list's filters, small, in one row with Columns.
const CONTROL = 'h-7 rounded-md border bg-card px-2 text-xs outline-none focus:border-accent/50'
const controlTone = on => on ? 'border-accent/40 text-accent' : 'border-border text-muted'

// The list's sort and filters, kept between launches (validated on read, so a
// stale or edited value falls back to the default).
function usePersistentState(key, initial, valid, prefix = 'lokal-library-') {
  const storageKey = prefix + key
  const [value, setValue] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey))
      if (saved !== null && valid(saved)) return saved
    } catch {}
    return initial
  })
  const set = useCallback(next => {
    setValue(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
  }, [storageKey])
  return [value, set]
}

const SORT_OPTIONS = [
  ['added_at DESC', 'Recently Added'],
  ['title ASC', 'Title A-Z'],
  ['artist ASC', 'Artist A-Z'],
  ['play_count DESC', 'Most Played'],
  ['duration DESC', 'Longest'],
  ['track_num ASC', 'Track number', '↑'],
  ['track_num DESC', 'Track number', '↓'],
  ['lyrics ASC', 'Lyrics'],
]
const SORTS = SORT_OPTIONS.map(([value]) => value)
const SOURCES = ['all', 'local', 'yt', 'sc', 'addon', 'soulseek', 'web']
const QUALITIES = ['', 'hires', 'lossless', 'high', 'low', 'suspect']

/**
 * The Library tab: the songs of the folder picked in the sidebar.
 * With `fixedGenre` it's one genre's songs instead (the Genres tab; '__none__'
 * for songs without a genre), from the whole library, under `title`, with
 * its own sort and filters.
 */
export default function Library({ fixedGenre = null, title = null, onBack = null }) {
  const { t } = useTranslation()
  const sidebarFolder = useLibraryFolder()
  const inGenre = fixedGenre != null
  const folder = inGenre ? '' : sidebarFolder
  const cacheKey = inGenre ? `genre:${fixedGenre}:` : 'library:'
  const prefsKey = inGenre ? 'lokal-genre-' : 'lokal-library-'
  // Kept across visits (with the sort and folder they were shown in), so coming
  // back paints the list at once instead of "No tracks yet" first.
  const [tracks, setTracks, wasCached] = useCachedState(cacheKey + 'tracks', [])
  const [sort, setSort] = usePersistentState('sort', 'added_at DESC', v => SORTS.includes(v), prefsKey)
  // Where the songs came from (see sourceFilter in electron/ipc/scanner.js).
  const [source, setSource] = usePersistentState('source', 'all', v => SOURCES.includes(v), prefsKey)
  // One genre, or '' for all (matches a song's main genre or any of its genres).
  const [pickedGenre, setGenre] = usePersistentState('genre', '', v => typeof v === 'string', prefsKey)
  const genre = inGenre ? fixedGenre : pickedGenre
  const [genres, setGenres] = useCachedState('library:genres', [])
  // One audio quality tier, or '' for all (the Audio Quality page's tiers).
  const [quality, setQuality] = usePersistentState('quality', '', v => QUALITIES.includes(v), prefsKey)
  const [problemsOnly, setProblemsOnly] = usePersistentState('problemsOnly', false, v => typeof v === 'boolean', prefsKey)
  const [musicFolderSet, setMusicFolderSet] = useState(() => peekSettings() ? !!peekSettings()?.music_folder : true)
  const [loading, setLoading] = useState(false)
  // How many songs the folder (with these filters) has; the list loads in pages.
  const [total, setTotal] = useCachedState(cacheKey + 'total', null)
  const [hasMore, setHasMore] = useCachedState(cacheKey + 'hasMore', true)
  // The empty state waits for the first answer instead of showing meanwhile.
  const [loaded, setLoaded] = useState(wasCached)
  usePageReady(loaded)
  const offsetRef = useRef(tracks.length)
  const loadingRef = useRef(false)
  const loadMoreRef = useRef(null)
  const requestIdRef = useRef(0)
  const folderName = inGenre ? (title || fixedGenre) : folder ? folder.split('/').pop() : t('Library')
  // Another folder picked: the old list fades out and the new one in once
  // its songs are here, instead of the rows swapping at once.
  const [listFolder, setListFolder] = useState(folder)
  const switchingFolder = listFolder !== folder
  // Settings > Appearance > Layout > Folder switch animation.
  const transition = useAppearanceText('folder_transition', 'slide')

  // Sorted by track number, biggest first, the list is the folder's order
  // (its tags): songs can be reordered, dragged to another folder, and files
  // dropped in from the computer (desktop app, a folder open, no filters).
  const folderOrder = api.isElectron && !inGenre && !!folder && sort === 'track_num DESC'
  const [reorder, setReorder] = useState(null) // { tracks, numbers } while reordering
  const [savingOrder, setSavingOrder] = useState(false)
  const startReorder = async () => {
    const all = await Promise.resolve(api.getTracks({ folder, sort: 'track_num DESC', limit: 5000 })).catch(() => null)
    if (!Array.isArray(all)) { showToast(t('Could not load this folder.')); return }
    const list = all.filter(track => !String(track?.file_path || '').startsWith('ghost://'))
    setReorder({ tracks: list, numbers: draftNumbers(list) })
  }
  const saveReorder = async () => {
    if (!reorder) return
    const changes = reorder.tracks
      .map((track, index) => ({ id: track.id, track_num: reorder.numbers[index], before: Number(track.track_num) }))
      .filter(item => item.track_num !== item.before)
      .map(({ id, track_num }) => ({ id, track_num }))
    setSavingOrder(true)
    const result = changes.length ? await Promise.resolve(api.setTrackNumbers(changes)).catch(e => ({ ok: false, error: e.message, failed: [] })) : { ok: true, saved: 0 }
    setSavingOrder(false)
    if (!result?.ok) showToast(result?.failed?.length ? t("Couldn't save {n} track numbers: {error}", { n: result.failed.length, error: result.failed[0]?.error || '?' }) : t('Could not save: {error}', { error: result?.error || '?' }))
    else if (changes.length) showToast(t('New order saved: {n} track numbers written', { n: result.saved ?? changes.length }))
    setReorder(null)
    load(false)
  }

  // A song held for 1.5 s, then dropped on a folder in the sidebar, moves there.
  // "Can't move <song>: <why>", the reason in the app's language (the
  // system's own message added when it's not one Lokal knows).
  const moveFailed = (track, result) => {
    const reason = result?.error ? t(result.error) : t('Unexpected error')
    return t('Can’t move “{title}”: {reason}', { title: track.title, reason: result?.detail ? `${reason} (${result.detail})` : reason })
  }

  // First asked: "Move to folder?" with the song's tags and its new number.
  const [pendingMove, setPendingMove] = useState(null) // { track, target, preview }
  const [moving, setMoving] = useState(false)
  const grab = useFolderGrab(async (track, target) => {
    if (!target) return
    if (target === folder) { showToast(t('“{title}” is already in this folder', { title: track.title })); return }
    const preview = await Promise.resolve(api.previewMove(track.id, target)).catch(e => ({ ok: false, error: e.message }))
    if (!preview?.ok) { showToast(moveFailed(track, preview)); return }
    setPendingMove({ track, target, preview })
  })
  const moveTrack = async () => {
    if (!pendingMove) return
    const { track, target } = pendingMove
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
    const move = () => Promise.resolve(api.moveTrackToFolder(track.id, target)).catch(e => ({ ok: false, error: 'Unexpected error', detail: e.message }))
    setMoving(true)
    // Given MOVE_TIMEOUT_MS at most: then the move is called off, the dialog
    // closes and says why (a file another program holds can't be waited out).
    const deadline = Date.now() + MOVE_TIMEOUT_MS
    const timedOut = { ok: false, timedOut: true, error: 'It took longer than 5 seconds: the file is probably held by another program' }
    const beforeDeadline = promise => Promise.race([promise, wait(Math.max(0, deadline - Date.now())).then(() => timedOut)])
    let result = await beforeDeadline(move())
    // The player has the file open (it's playing, or loaded next): it lets
    // go, the move is tried again, and the song carries on from its new place.
    let released = null
    if (!result?.ok && result?.busy) {
      const detail = { filePath: track.file_path, trackId: track.id }
      window.dispatchEvent(new CustomEvent('lokal:release-file', { detail }))
      if (detail.released) {
        released = detail
        for (const delay of [300, 900]) {
          if (Date.now() + delay >= deadline) break
          await wait(delay)
          result = await beforeDeadline(move())
          if (result?.ok || !result?.busy) break
        }
      }
    }
    setMoving(false)
    setPendingMove(null)
    if (!result?.ok) {
      released?.restore?.()
      showToast(moveFailed(track, result))
      return
    }
    if (result.track) usePlayerStore.getState().syncTrack(result.track)
    showToast(t('“{title}” moved to {folder}', { title: track.title, folder: target.split('/').pop() }))
    window.dispatchEvent(new Event('lokal:refresh'))
    setLibraryFolder(target)
  }

  // Files dropped from the computer onto the open folder: copied into it
  // (after asking), numbered on from its biggest track number.
  const [dropping, setDropping] = useState(false)
  const [pendingFiles, setPendingFiles] = useState(null)
  // Their title and artist (tags) and the number each will get, for the dialog.
  const [filePreview, setFilePreview] = useState(null)
  useEffect(() => {
    setFilePreview(null)
    if (!pendingFiles) return undefined
    let alive = true
    Promise.resolve(api.previewFilesForFolder(pendingFiles, folder))
      .then(list => { if (alive && Array.isArray(list)) setFilePreview(list) })
      .catch(() => {})
    return () => { alive = false }
  }, [pendingFiles, folder])
  const [addingFiles, setAddingFiles] = useState(false)
  const canDropFiles = api.isElectron && !inGenre && !!folder && !reorder
  const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files')
  const dropHandlers = canDropFiles ? {
    onDragOver: event => { if (!hasFiles(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropping(true) },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false) },
    onDrop: event => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDropping(false)
      const paths = Array.from(event.dataTransfer.files || []).map(file => api.pathForFile(file)).filter(Boolean)
      if (paths.length) setPendingFiles(paths)
    },
  } : {}
  const addFiles = async () => {
    const paths = pendingFiles
    setAddingFiles(true)
    const result = await Promise.resolve(api.addFilesToFolder(paths, folder)).catch(e => ({ ok: false, error: e.message, added: [], failed: [] }))
    setAddingFiles(false)
    setPendingFiles(null)
    const added = result?.added?.length || 0
    if (added) showToast(t('Added {n} files to {folder}', { n: added, folder: folderName }))
    if (result?.failed?.length) showToast(t("Couldn't add {n} files: {error}", { n: result.failed.length, error: result.failed[0]?.error || '?' }))
    else if (!added && result?.error) showToast(t('Could not add the files: {error}', { error: result.error }))
    window.dispatchEvent(new Event('lokal:refresh'))
  }

  const load = async (append = false) => {
    // Synchronous in-flight check: the observer's `loading` can be stale, and a
    // load-more mustn't supersede the first-page refresh (or run twice).
    if (loadingRef.current && append) return
    const requestId = ++requestIdRef.current
    const nextOffset = append ? offsetRef.current : 0
    loadingRef.current = true
    setLoading(true)
    try {
      const filters = { ...(folder ? { folder } : {}), ...(source !== 'all' ? { source } : {}), ...(genre ? { genre } : {}), ...(quality ? { quality } : {}), ...(problemsOnly ? { problems: true } : {}) }
      if (!append) {
        Promise.resolve(api.getTracks({ ...filters, count: true }))
          .then(r => { if (requestId === requestIdRef.current && Number.isFinite(r?.count)) setTotal(r.count) })
          .catch(() => {})
      }
      const result = await api.getTracks({ sort, limit: LIBRARY_PAGE_SIZE, offset: nextOffset, ...filters })
      if (requestId !== requestIdRef.current) return
      // A failed request keeps the list already shown (and cached).
      if (!Array.isArray(result)) { if (!append) setListFolder(folder); return }
      const items = problemsOnly ? result : result.filter(track => !String(track?.file_path || '').startsWith('ghost://'))
      offsetRef.current = nextOffset + items.length
      setTracks(prev => append ? [...prev, ...items] : items)
      if (!append) setListFolder(folder)
      setHasMore(items.length === LIBRARY_PAGE_SIZE)
      // Only a real answer ends the first load ("No tracks yet" must be true).
      setLoaded(true)
    } finally {
      if (requestId === requestIdRef.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }

  // The list on screen (from last time, or the previous folder) stays until
  // the new first page replaces it; a failed request leaves it as it is.
  useEffect(() => {
    // Another folder, sort or filter: nothing more is fetched (or appended)
    // until its first page is in, so two lists are never mixed.
    offsetRef.current = 0
    setHasMore(false)
    load(false)
  }, [folder, sort, source, genre, quality, problemsOnly])

  useEffect(() => {
    const handleRefresh = () => { load(false); loadGenres() }
    window.addEventListener('lokal:refresh', handleRefresh)
    return () => window.removeEventListener('lokal:refresh', handleRefresh)
  }, [folder, sort, source, genre, quality, problemsOnly])

  // One song edited (tags, lyrics in its file): read just it again and put it
  // where the current sort and filters put it -- or out, if it no longer matches.
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  useEffect(() => {
    const onChanged = async (e) => {
      const trackId = e.detail?.trackId
      if (trackId == null) return
      const filters = { sort, ...(folder ? { folder } : {}), ...(source !== 'all' ? { source } : {}), ...(genre ? { genre } : {}), ...(quality ? { quality } : {}), ...(problemsOnly ? { problems: true } : {}) }
      const fresh = await readTrack(trackId, filters)
      setTracks(prev => {
        if (!fresh && !prev.some(row => String(row?.id) === String(trackId))) return prev
        const next = placeTrack(prev, trackId, fresh, sort, hasMoreRef.current)
        offsetRef.current += next.length - prev.length
        return next
      })
    }
    window.addEventListener(TRACK_CHANGED, onChanged)
    return () => window.removeEventListener(TRACK_CHANGED, onChanged)
  }, [folder, sort, source, genre, quality, problemsOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // The genres to pick from: every one in the library, on opening and after a refresh.
  const loadGenres = () => Promise.resolve(api.getAllGenres())
    .then(list => { if (Array.isArray(list)) setGenres(list.filter(g => typeof g === 'string' && g.trim())) })
    .catch(() => {})
  useEffect(() => {
    loadGenres()
    api.getSettings().then(s => setMusicFolderSet(!!s?.music_folder)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!hasMore || loading) return
    const node = loadMoreRef.current
    if (!node) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        load(true)
      }
    }, { rootMargin: '300px 0px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, loading, folder, sort, source, genre, quality, problemsOnly, tracks.length])

  const activeFilters = (source !== 'all' ? 1 : 0) + (genre && !inGenre ? 1 : 0) + (quality ? 1 : 0) + (problemsOnly ? 1 : 0)
  const clearFilters = () => { setSource('all'); if (!inGenre) setGenre(''); setQuality(''); setProblemsOnly(false) }

  const header = (
    <div className="flex min-w-0 items-center gap-3">
      {onBack && (
        <button type="button" onClick={onBack} title={t('Back')} aria-label={t('Back')}
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-elevated text-muted transition-colors hover:text-white">
          <ArrowLeft size={14} />
        </button>
      )}
      <h1 className="min-w-0 truncate font-display text-lg uppercase tracking-widest text-white" title={folderName}>{folderName}</h1>
      {/* The folder's song count, in the folder name's type; hovering tells
          how many of them are loaded so far. */}
      <span className="flex-shrink-0 font-display text-lg uppercase tracking-widest text-muted"
        title={t('Loaded {loaded} of {total} tracks', { loaded: tracks.length, total: total ?? tracks.length })}>
        {total ?? `${tracks.length}${hasMore ? '+' : ''}`}
      </span>
    </div>
  )

  const controls = reorder ? <>
    <button type="button" onClick={() => setReorder(null)} disabled={savingOrder}
      className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs text-muted transition-colors hover:text-white disabled:opacity-50">
      <X size={13} /> {t('Cancel')}
    </button>
    <button type="button" onClick={saveReorder} disabled={savingOrder}
      className="flex h-7 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-2.5 text-xs text-accent transition-colors hover:bg-accent/25 disabled:opacity-50">
      <Check size={13} /> {savingOrder ? t('Saving...') : t('Save')}
    </button>
  </> : <>
    {folderOrder && activeFilters === 0 && (
      <button type="button" onClick={startReorder} title={t('Drag the songs into a new order; saving writes their new track numbers into the files.')}
        className="flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted hover:bg-elevated hover:text-text focus-visible:outline focus-visible:outline-accent">
        <ListOrdered size={14} /> {t('Reorder')}
      </button>
    )}
    <ToolbarMenu icon={ArrowDownUp} label={t("Sort")} width="w-56">
      {close => <>
        <p className="px-2 py-1.5 text-xs font-display uppercase tracking-wider text-muted">{t("Sort by")}</p>
        {SORT_OPTIONS.map(([value, label, arrow]) => (
          <button key={value} type="button" onClick={() => { setSort(value); close(true) }}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-card ${sort === value ? 'text-accent' : 'text-text'}`}>
            <Check size={13} className={sort === value ? '' : 'invisible'} aria-hidden="true" />
            <span className="flex-1">{t(label)}{arrow ? ` ${arrow}` : ''}</span>
          </button>
        ))}
      </>}
    </ToolbarMenu>
    <ToolbarMenu icon={SlidersHorizontal} label={t("Filters")} badge={activeFilters || null} active={activeFilters > 0}>
      <p className="px-2 py-1.5 text-xs font-display uppercase tracking-wider text-muted">{t("Filters")}</p>
      <div className="space-y-2 px-2 py-1">
        <select value={source} onChange={e => setSource(e.target.value)} aria-label={t("Source")} className={`${CONTROL} w-full ${controlTone(source !== 'all')}`}>
          <option value="all">{t("All sources")}</option>
          <option value="local">{t("Music folder")}</option>
          <option value="yt">YouTube</option>
          <option value="sc">SoundCloud</option>
          <option value="addon">{t('Addons')}</option>
          <option value="soulseek">Soulseek</option>
          <option value="web">{t("Other sites")}</option>
        </select>
        {!inGenre && <select value={genre} onChange={e => setGenre(e.target.value)} aria-label={t("Genres")} className={`${CONTROL} w-full truncate ${controlTone(!!genre)}`}>
          <option value="">{t("All genres")}</option>
          {/* The one picked stays listed even if no song has it any more. */}
          {genre && !genres.some(g => g.toLowerCase() === genre.toLowerCase()) && <option value={genre}>{genre}</option>}
          {genres.map(g => <option key={g} value={g}>{g}</option>)}
        </select>}
        <select value={quality} onChange={e => setQuality(e.target.value)} aria-label={t("Quality")} className={`${CONTROL} w-full ${controlTone(!!quality)}`}>
          <option value="">{t("All qualities")}</option>
          <option value="hires">Hi-res</option>
          <option value="lossless">{t('Lossless')}</option>
          <option value="high">{t('High')}</option>
          <option value="low">{t('Low')}</option>
          <option value="suspect">{t('Suspect')}</option>
        </select>
        <label title={t("Only songs that can't be played: their file is missing, or playing them failed")} className={`flex cursor-pointer items-center gap-2.5 rounded-lg py-1 text-sm ${problemsOnly ? 'text-accent' : 'text-text'}`}>
          <input type="checkbox" checked={problemsOnly} onChange={e => setProblemsOnly(e.target.checked)} className="accent-accent" />{t("Songs with errors")}
        </label>
      </div>
      <div className="mt-1 border-t border-border pt-1">
        <button type="button" onClick={clearFilters} disabled={!activeFilters}
          className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-accent hover:bg-card disabled:text-muted disabled:hover:bg-transparent">
          {t("Clear all filters")}
        </button>
      </div>
    </ToolbarMenu>
  </>

  const reorderNumbers = reorder ? new Map(reorder.tracks.map((track, index) => [track.id, reorder.numbers[index]])) : null

  return (
    <div className="relative px-6 pt-0 space-y-3 pb-10 min-h-full" {...dropHandlers}>

      {!musicFolderSet && <ScanBanner />}

      {reorder ? (
        <TrackList stickyBleed="1.5rem" tracks={reorder.tracks} showQuality reduceMotion reorderable trackNumbers={reorderNumbers}
          onReorder={ids => setReorder(prev => {
            const byId = new Map(prev.tracks.map(track => [track.id, track]))
            return { ...prev, tracks: ids.map(id => byId.get(id)).filter(Boolean) }
          })}
          toolbarStart={header} toolbarEnd={controls} />
      ) : tracks.length > 0 ? (
        // No per-row entrance: the page fades in as a whole, and 50 row
        // animations in the same frames made that fade stutter.
        <div key={transition === 'fade' || transition === 'none' ? undefined : listFolder} {...folderTransitionProps(transition, switchingFolder)}>
          <TrackList stickyBleed="1.5rem" tracks={tracks} showQuality reduceMotion toolbarStart={header} toolbarEnd={controls}
            onGrab={folderOrder && activeFilters === 0 ? grab.start : null} />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-2 pt-2">{header}<div className="flex items-center gap-1">{controls}</div></div>
      )}

      {grab.ghost}

      {dropping && (
        <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent/60 bg-bg/70 backdrop-blur-sm">
          <p className="flex items-center gap-2 font-display text-sm uppercase tracking-widest text-accent"><FolderInput size={18} /> {t('Drop to add to {folder}', { folder: folderName })}</p>
        </div>
      )}

      <Modal open={!!pendingMove} onClose={() => { if (!moving) setPendingMove(null) }} title={t('Move to another folder?')} width="max-w-md">
        <div className="space-y-4">
          <div className="flex min-w-0 items-center gap-3 rounded-lg bg-card/60 px-3 py-2.5">
            <span className="flex-shrink-0 font-display text-lg text-accent">#{pendingMove?.preview?.trackNum}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-white">
                {[pendingMove?.preview?.artist, pendingMove?.preview?.title].filter(Boolean).join(' - ') || pendingMove?.preview?.fileName}
              </span>
              <span className="block truncate text-[11px] text-muted">{pendingMove?.preview?.fileName}</span>
            </span>
          </div>
          <p className="text-sm leading-relaxed text-muted">{t('The file moves to {folder} and gets track number {n}, the biggest there, so it goes to the top.', { folder: String(pendingMove?.target || '').split('/').pop(), n: pendingMove?.preview?.trackNum ?? '' })}</p>
          <div className="flex gap-2">
            <button onClick={() => setPendingMove(null)} disabled={moving} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50">{t('Cancel')}</button>
            <button onClick={moveTrack} disabled={moving} autoFocus className="flex-1 py-2.5 rounded-xl border border-accent/30 bg-accent/20 text-sm font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50">
              {moving ? t('Moving…') : t('Move')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!pendingFiles} onClose={() => { if (!addingFiles) setPendingFiles(null) }} title={t('Add files to the folder?')} width="max-w-md">
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">{t('{n} files will be copied to {folder} and numbered after its last track.', { n: pendingFiles?.length || 0, folder: folderName })}</p>
          <ul className="max-h-60 space-y-1 overflow-y-auto text-xs text-white/80">
            {(filePreview || (pendingFiles || []).map(filePath => ({ filePath }))).map(item => (
              <li key={item.filePath} className="flex min-w-0 items-center gap-2.5 rounded-lg bg-card/60 px-2.5 py-1.5" title={item.filePath}>
                <span className="w-9 flex-shrink-0 text-right font-display text-muted">{item.trackNum != null ? `#${item.trackNum}` : '—'}</span>
                <span className="min-w-0 flex-1">
                  {item.title || item.artist
                    ? <span className="block truncate text-white">{[item.artist, item.title].filter(Boolean).join(' - ')}</span>
                    : null}
                  <span className="block truncate text-[11px] text-muted">{fileName(item.filePath)}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button onClick={() => setPendingFiles(null)} disabled={addingFiles} className="flex-1 py-2.5 bg-card border border-border rounded-xl text-sm text-muted hover:text-white transition-colors disabled:opacity-50">{t('Cancel')}</button>
            <button onClick={addFiles} disabled={addingFiles} autoFocus className="flex-1 py-2.5 rounded-xl border border-accent/30 bg-accent/20 text-sm font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50">
              {addingFiles ? t('Adding…') : t('Add')}
            </button>
          </div>
        </div>
      </Modal>

      {!reorder && (hasMore || loading) && (
        <div ref={loadMoreRef} className="flex justify-center pt-2 min-h-10">
          {loading && tracks.length > 0 && <p className="text-xs text-muted">{t("Loading more tracks...")}</p>}
        </div>
      )}

      {loaded && !loading && !tracks.length && (
        <div className="text-center py-24 text-muted">
          <Music size={48} className="mx-auto mb-4 opacity-20" />
          <p>{problemsOnly ? t('No songs with errors: everything here can be played.') : source === 'all' && !genre && !quality ? (musicFolderSet ? t('This folder is empty.') : t('No tracks yet — pick your music folder above.')) : quality ? t('No songs of this quality with these filters.') : genre ? (source === 'all' ? t('No {genre} songs.', { genre: inGenre ? folderName : genre }) : t('No {genre} songs from this source.', { genre: inGenre ? folderName : genre })) : t('No songs from this source.')}</p>
          {genre && !inGenre && (
            <button onClick={() => setGenre('')} className="mt-3 text-xs text-accent transition-colors hover:text-accent/70">{t("Show all genres")}</button>
          )}
          {quality && (
            <button onClick={() => setQuality('')} className="mt-3 ml-3 text-xs text-accent transition-colors hover:text-accent/70">{t("Show all qualities")}</button>
          )}
        </div>
      )}
    </div>
  )
}
