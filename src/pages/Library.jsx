import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDownUp, ArrowLeft, Check, Music, SlidersHorizontal } from 'lucide-react'
import ToolbarMenu from '../components/ToolbarMenu'
import TrackList from '../components/TrackList'
import ScanBanner from '../components/ScanBanner'
import { api, peekSettings } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import { useLibraryFolder } from '../libraryNav'
import { useTranslation } from '../i18n'
import { TRACK_CHANGED, readTrack, placeTrack } from '../trackChanged'

const LIBRARY_PAGE_SIZE = 50

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
      if (!Array.isArray(result)) return
      const items = problemsOnly ? result : result.filter(track => !String(track?.file_path || '').startsWith('ghost://'))
      offsetRef.current = nextOffset + items.length
      setTracks(prev => append ? [...prev, ...items] : items)
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

  const controls = <>
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

  return (
    <div className="p-6 space-y-3 pb-10">

      {!musicFolderSet && <ScanBanner />}

      {tracks.length > 0 ? (
        // No per-row entrance: the page fades in as a whole, and 50 row
        // animations in the same frames made that fade stutter.
        <TrackList tracks={tracks} showQuality reduceMotion toolbarStart={header} toolbarEnd={controls} />
      ) : (
        <div className="flex items-center justify-between gap-3 px-2">{header}<div className="flex items-center gap-1">{controls}</div></div>
      )}

      {(hasMore || loading) && (
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
