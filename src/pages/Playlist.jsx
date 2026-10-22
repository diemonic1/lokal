import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Heart, Music, Play, Shuffle, Trash2, Edit2, Check, X, RefreshCw, Image as ImageIcon, Search, Sparkles, SlidersHorizontal, Share2, ListOrdered } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import TrackList from '../components/TrackList'
import PlaylistCover from '../components/PlaylistCover'
import { api } from '../api'
import { showToast } from '../components/Toaster'
import { describeRules, openSmartPlaylistEditor } from '../smartPlaylists'
import { openShareCard, coversOf } from '../shareCard'
import { makePlaylistContext } from '../playbackContext'
import { isPlayable } from '../onlineTracks'
import { plural } from '../plural'
import { useCachedState, usePageReady } from '../pageCache'
import { filterPlaylistTracks } from '../playlistSearch'
import { useFavoritesEnabled } from '../appearanceFlags'
import { useTranslation } from '../i18n'

// The playlist's actions, as plain icons beside the Play button.
const ICON_BUTTON = 'flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

export default function Playlist() {
  const { t } = useTranslation()
  const { id } = useParams()
  const nav = useNavigate()
  const { user } = useAppStore()
  const isLiked = id === 'liked'
  // Kept across visits, like the other pages: coming back to a playlist
  // paints it at once (and it still refetches quietly), and a new one stays
  // hidden until its songs and name are in, instead of showing "Playlist ·
  // 0 tracks · This playlist is empty" first. The route remounts per
  // playlist, so the keys never change while mounted.
  const cacheKey = isLiked ? `playlist:liked:${user?.id || 'guest'}` : `playlist:${id}`
  const [tracks, setTracks, tracksCached] = useCachedState(`${cacheKey}:tracks`, [])
  // No sorting in a playlist: its own order (the file's), changed by dragging.
  const sortedTracks = tracks
  const trackNumbers = useMemo(() => new Map(tracks.map((track, index) => [track.playlist_track_id ?? track.id, index + 1])), [tracks])
  const favorites = useFavoritesEnabled()
  const [playlist, setPlaylist, metaCached] = useCachedState(`${cacheKey}:meta`, null)
  // A playlist is ready from the cache only with its name too (left before
  // that came in, it would show "Playlist" until it did).
  const [loaded, setLoaded] = useState(tracksCached && (isLiked || metaCached))
  usePageReady(loaded)
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(() => playlist?.name || '')
  const [recommendations, setRecommendations] = useCachedState(`${cacheKey}:recs`, [])
  const [loadingRecs, setLoadingRecs] = useState(false)
  const [playlistSearchOpen, setPlaylistSearchOpen] = useState(false)
  const [playlistSearch, setPlaylistSearch] = useState('')
  const playlistSearchRef = useRef(null)
  const visibleTracks = useMemo(() => filterPlaylistTracks(sortedTracks, playlistSearch), [sortedTracks, playlistSearch])
  const playQueue = usePlayerStore(s => s.playQueue)
  const location = useLocation()
  // load() below re-fetches on every id change but doesn't clear `playlist`
  // first, so right after navigating from one playlist to another, `playlist`
  // still holds the PREVIOUS playlist's data for as long as the new fetch is
  // in flight -- makePlaylistContext prefers playlist.id over the id fallback,
  // so playing a track during that window stored a context pointing back at
  // the playlist the user just navigated away from. Only trust `playlist`
  // once its id actually matches the current route.
  const playlistMatchesRoute = playlist && String(playlist.id) === String(id)
  const playbackContext = useMemo(
    () => makePlaylistContext(isLiked ? { id: 'liked', name: 'Liked Songs' } : (playlistMatchesRoute ? playlist : null), id),
    [isLiked, playlistMatchesRoute, playlist, id],
  )
  // Set by the "playing from ..." shortcut so we can scroll to the playing track.
  const [highlightTrackId, setHighlightTrackId] = useState(null)
  // A per-request identity, distinct from the track ID itself, so a second
  // shortcut to the *same* already-playing track still re-triggers the
  // scroll/flash in TrackList instead of being silently deduped against
  // the first request for that ID.
  const highlightSeqRef = useRef(0)
  const [highlightRequestKey, setHighlightRequestKey] = useState(null)

  useEffect(() => {
    const incoming = location.state?.highlightTrackId
    if (!incoming) return
    highlightSeqRef.current += 1
    setHighlightTrackId(incoming)
    setHighlightRequestKey(`${incoming}:${highlightSeqRef.current}`)
    // Clear it so a later refresh or back-navigation doesn't re-trigger the scroll.
    nav(location.pathname, { replace: true, state: {} })
  }, [location.pathname, location.state, nav])

  // Online songs are ghost tracks too, but they stream, so they play.
  const playableTracks = useMemo(() => sortedTracks.filter(track => isPlayable(track)), [sortedTracks])

  // A smart playlist fills itself from its rules: no adding, removing or reordering by hand.
  const smart = !isLiked && !!playlist?.smart_rules

  const load = useCallback(() => {
    // The page shows once both the songs and the name are in (or failed).
    const done = () => setLoaded(true)
    if (isLiked) {
      Promise.resolve(api.getPlaylistTracks('liked')).then(t => setTracks(Array.isArray(t) ? t : [])).catch(() => {}).finally(done)
      return
    }
    const songs = Promise.resolve(api.getPlaylistTracks(id)).then(t => {
      setTracks(Array.isArray(t) ? t : [])
    })
    const meta = Promise.resolve(api.getPlaylists(user?.id)).then(pls => {
      const pl = (Array.isArray(pls) ? pls : []).find(p => String(p.id) === String(id))
      if (pl) {
        setPlaylist(pl)
        setNameVal(pl.name)
      }
    })
    Promise.allSettled([songs, meta]).then(done)
  }, [id, user?.id, isLiked, setTracks, setPlaylist])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (playlistSearchOpen) playlistSearchRef.current?.focus()
  }, [playlistSearchOpen])

  useEffect(() => {
    const handleChange = (e) => {
      const playlistId = e?.detail?.playlistId
      if (playlistId) {
        if (String(playlistId) === String(id)) load()
      } else {
        load()
      }
    }

    const handleDeleted = (e) => {
      const playlistId = e?.detail?.playlistId
      if (playlistId && String(playlistId) === String(id)) nav('/playlists')
      else load()
    }

    window.addEventListener('lokal:playlist-updated', handleChange)
    window.addEventListener('lokal:playlist-created', handleChange)
    window.addEventListener('lokal:playlists-changed', handleChange)
    window.addEventListener('lokal:playlist-deleted', handleDeleted)
    window.addEventListener('lokal:refresh', handleChange)

    return () => {
      window.removeEventListener('lokal:playlist-updated', handleChange)
      window.removeEventListener('lokal:playlist-created', handleChange)
      window.removeEventListener('lokal:playlists-changed', handleChange)
      window.removeEventListener('lokal:playlist-deleted', handleDeleted)
      window.removeEventListener('lokal:refresh', handleChange)
    }
  }, [id, load, nav])

  const removeTrack = async (track) => {
    const result = await api.removeFromPlaylist(id, [track.id])
    if (result?.error) return
    setTracks(t => t.filter(tr => tr.id !== track.id))
    window.dispatchEvent(new CustomEvent(isLiked ? 'lokal:playlists-changed' : 'lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const saveName = async () => {
    if (!nameVal.trim() || !playlist) return
    await api.updatePlaylist(id, { name: nameVal.trim() })
    setPlaylist(p => ({ ...p, name: nameVal.trim() }))
    setEditingName(false)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const deletePlaylist = async () => {
    if (!confirm(t('Delete this playlist?'))) return
    await api.deletePlaylist(id)
    window.dispatchEvent(new CustomEvent('lokal:playlists-changed', {
      detail: { playlistId: id, action: 'deleted' },
    }))
    nav('/playlists')
  }

  // "Reorder" (as in Library's folders): the songs are dragged in a draft,
  // written to the playlist's file only on Save; Cancel drops the draft.
  const [reorder, setReorder] = useState(null) // the songs in their new order while reordering
  const [savingOrder, setSavingOrder] = useState(false)
  const startReorder = () => {
    setPlaylistSearchOpen(false)
    setPlaylistSearch('')
    setReorder(tracks)
  }
  const saveReorder = async () => {
    if (!reorder) return
    setSavingOrder(true)
    const result = await Promise.resolve(api.reorderPlaylist(id, reorder.map(track => track.id))).catch(e => ({ error: e.message }))
    setSavingOrder(false)
    if (result?.error) { showToast(t('Could not save: {error}', { error: t(result.error) })); return }
    setTracks(reorder)
    setReorder(null)
    window.dispatchEvent(new CustomEvent(isLiked ? 'lokal:playlists-changed' : 'lokal:playlist-updated', { detail: { playlistId: id } }))
  }
  const reorderNumbers = useMemo(() => reorder && new Map(reorder.map((track, index) => [track.playlist_track_id ?? track.id, index + 1])), [reorder])

  const fetchRecommendations = useCallback(async () => {
    if (isLiked) return
    setLoadingRecs(true)
    try {
      const allTracks = await api.getTracks()
      if (Array.isArray(allTracks)) {
        const currentIds = new Set(tracks.map(t => t.id))
        const currentArtists = new Set(tracks.map(t => t.artist))
        const available = allTracks.filter(t => !currentIds.has(t.id) && !String(t.file_path || '').startsWith('ghost://'))
        const related = available.filter(t => currentArtists.has(t.artist))
        const others = available.filter(t => !currentArtists.has(t.artist))
        const shuffleList = (arr) => [...arr].sort(() => Math.random() - 0.5)
        let recs = shuffleList(related).slice(0, 5)
        if (recs.length < 5) recs = [...recs, ...shuffleList(others).slice(0, 5 - recs.length)]
        setRecommendations(recs)
      }
    } catch (e) {
      console.error(e)
    }
    setLoadingRecs(false)
  }, [tracks, isLiked])

  useEffect(() => {
    if (!isLiked && !smart && tracks.length > 0 && tracks.length <= 300 && recommendations.length === 0) {
      fetchRecommendations()
    }
  }, [tracks.length, isLiked, smart, recommendations.length, fetchRecommendations])

  // A recommended song that's now in the playlist
  // leaves the recommendations, cached ones included; an emptied list is
  // refilled by the effect above.
  useEffect(() => {
    if (!recommendations.length) return
    const inPlaylist = new Set(tracks.map(track => track.id))
    if (recommendations.some(track => inPlaylist.has(track.id))) {
      setRecommendations(current => current.filter(track => !inPlaylist.has(track.id)))
    }
  }, [tracks, recommendations, setRecommendations])

  const addRecommendation = async (track) => {
    await api.addToPlaylist(id, track.id)
    setRecommendations(prev => prev.filter(t => t.id !== track.id))
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const totalDuration = tracks.reduce((sum, track) => sum + (track.duration || 0), 0)
  const fmt = (seconds) => Math.floor(seconds / 3600) > 0
    ? t('{h}h {m}m', { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60) })
    : t('{m}m', { m: Math.floor((seconds % 3600) / 60) })

  // The share card: its photo (or the first four covers), name and first songs.
  const sharePlaylist = () => {
    const artists = new Set(tracks.map(track => String(track.artist || '').split(/\s*,\s*/)[0]).filter(Boolean))
    openShareCard({
      kind: smart ? t('Smart playlist') : t('Playlist'),
      title: isLiked ? t('Liked Songs') : (playlist?.name || t('Playlist')),
      subtitle: smart ? describeRules(playlist.smart_rules) : (playlist?.description || ''),
      art: playlist?.cover_path ? [{ path: playlist.cover_path, url: api.isElectron ? null : api.playlistCoverURL(id) }] : coversOf(tracks, 4),
      stats: [[t('Songs'), tracks.length.toLocaleString()], [t('Length'), fmt(totalDuration)], [t('Artists'), artists.size.toLocaleString()]],
      list: { title: t('Songs'), items: tracks.slice(0, 5).map(track => [track.title, track.artist]) },
    })
  }

  const shuffleTracks = () => {
    if (!playableTracks.length) return
    const shuffled = [...playableTracks].sort(() => Math.random() - 0.5)
    playQueue(shuffled, 0, playbackContext)
  }

  const uploadPlaylistPhoto = async () => {
    if (!api.isElectron || isLiked) return
    const fp = await api.openFile([{ name: t('Images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!fp) return
    const dataUrl = await api.readFileAsDataURL(fp)
    if (!dataUrl) return
    const updated = await api.updatePlaylist(id, { coverData: dataUrl })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  const clearPlaylistPhoto = async () => {
    if (isLiked) return
    const updated = await api.updatePlaylist(id, { clearCover: true })
    if (updated?.id) setPlaylist(updated)
    window.dispatchEvent(new CustomEvent('lokal:playlist-updated', { detail: { playlistId: id } }))
  }

  return (
    <div className="p-6 pb-10">
      <div className="flex items-end gap-4 mb-4">
        <div className="relative w-28 h-28 flex-shrink-0 group">
          <div className="w-28 h-28 rounded-2xl overflow-hidden bg-elevated border border-border flex items-center justify-center shadow-xl">
            {isLiked
              ? <Heart size={44} className="text-accent" fill="currentColor" />
              : <PlaylistCover playlistId={id} coverPath={playlist?.cover_path} size={112} className="w-full h-full object-cover" />
            }
          </div>
          {!isLiked && (
            <button
              onClick={uploadPlaylistPhoto}
              className="absolute inset-0 rounded-2xl bg-black/0 group-hover:bg-black/45 transition-colors flex items-center justify-center"
              title={playlist?.cover_path ? t('Change playlist photo') : t('Upload playlist photo')}
            >
              <span className="w-11 h-11 rounded-full bg-white/12 border border-white/15 text-white hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center">
                <ImageIcon size={17} />
              </span>
            </button>
          )}
          {!isLiked && playlist?.cover_path && (
            <div className="absolute top-3 right-3">
              <button
                onClick={(e) => { e.stopPropagation(); clearPlaylistPhoto() }}
                className="w-9 h-9 rounded-full bg-red-500/20 border border-red-400/25 text-red-200 hover:bg-red-500/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100"
                title={t("Reset playlist photo")}
              >
                <X size={15} />
              </button>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-display text-muted uppercase tracking-widest mb-1 flex items-center gap-1.5">
            {smart && <Sparkles size={11} className="text-accent" />}{smart ? t('Smart playlist') : t('Playlist')}
          </p>
          {!isLiked && editingName ? (
            <div className="flex items-center gap-2 mb-2">
              <input
                autoFocus
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                className="bg-elevated border border-accent/50 rounded-lg px-3 py-1.5 text-xl text-white font-display outline-none"
              />
              <button onClick={saveName} aria-label={t('Save')} title={t('Save')} className="text-accent hover:text-accent/70 transition-colors"><Check size={18} /></button>
              <button onClick={() => setEditingName(false)} aria-label={t('Cancel')} title={t('Cancel')} className="text-muted hover:text-white transition-colors"><X size={18} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-display text-white truncate">
                {isLiked ? t('Liked Songs') : (playlist?.name || t('Playlist'))}
              </h1>
              {!isLiked && (
                <button onClick={() => setEditingName(true)} aria-label={t('Rename playlist')} title={t('Rename playlist')} className="text-muted hover:text-white transition-colors flex-shrink-0">
                  <Edit2 size={14} />
                </button>
              )}
            </div>
          )}
          <p className="text-sm text-muted">{plural(tracks.length, 'track')}{totalDuration > 0 ? ` · ${fmt(totalDuration)}` : ''}</p>
          {smart && <p className="mt-1 text-xs text-muted/80 line-clamp-2" title={describeRules(playlist.smart_rules)}>{describeRules(playlist.smart_rules)}</p>}
        </div>
      </div>

      {/* No per-row entrance: the page fades in as a whole (see Library). */}
      <TrackList
        toolbarStart={reorder ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
            <p className="mr-auto text-sm text-muted">{t('Drag the songs into a new order, then save.')}</p>
            <button type="button" onClick={() => setReorder(null)} disabled={savingOrder}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted transition-colors hover:text-white disabled:opacity-50">
              <X size={13} /> {t('Cancel')}
            </button>
            <button type="button" onClick={saveReorder} disabled={savingOrder}
              className="flex h-8 items-center gap-1.5 rounded-md border border-accent/40 bg-accent/15 px-3 text-xs text-accent transition-colors hover:bg-accent/25 disabled:opacity-50">
              <Check size={13} /> {savingOrder ? t('Saving...') : t('Save')}
            </button>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap py-1 [&>*]:shrink-0">
            <button
              type="button"
              onClick={() => playQueue(playableTracks, 0, playbackContext)}
              disabled={!playableTracks.length}
              aria-label={t("Play All")}
              title={t("Play All")}
              className="mr-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-[rgb(var(--bg-rgb))] transition-colors hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={17} fill="currentColor" className="translate-x-px" />
            </button>
            {!!tracks.length && (playlistSearchOpen ? (
              <div className="mx-1 flex w-64 items-center gap-2 rounded-full border border-accent/40 bg-elevated px-3.5 py-2 text-sm text-white focus-within:border-accent">
                <Search size={15} className="flex-shrink-0 text-muted" />
                <input
                  ref={playlistSearchRef}
                  value={playlistSearch}
                  onChange={event => setPlaylistSearch(event.target.value)}
                  onKeyDown={event => { if (event.key === 'Escape') { setPlaylistSearchOpen(false); setPlaylistSearch('') } }}
                  placeholder={t("Search this playlist")}
                  aria-label={t("Search this playlist")}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
                />
                <button
                  type="button"
                  onClick={() => { setPlaylistSearchOpen(false); setPlaylistSearch('') }}
                  aria-label={t("Close playlist search")}
                  className="flex-shrink-0 text-muted transition-colors hover:text-white"
                >
                  <X size={15} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setPlaylistSearchOpen(true)} aria-label={t('Search this playlist')} title={t('Search this playlist')} className={ICON_BUTTON}>
                <Search size={17} />
              </button>
            ))}
            <button type="button" onClick={shuffleTracks} disabled={!playableTracks.length} aria-label={t("Shuffle")} title={t("Shuffle")} className={ICON_BUTTON}>
              <Shuffle size={17} />
            </button>
            {!smart && (
              <button type="button" onClick={startReorder} disabled={tracks.length < 2} aria-label={t('Reorder')} title={t('Reorder')} className={ICON_BUTTON}>
                <ListOrdered size={17} />
              </button>
            )}
            <button type="button" onClick={sharePlaylist} disabled={!tracks.length} aria-label={t('Share as a picture')} title={t('Share as a picture')} className={ICON_BUTTON}>
              <Share2 size={17} />
            </button>
            {!isLiked && (
              <>
                {smart && (
                  <button type="button" onClick={() => openSmartPlaylistEditor(playlist)} aria-label={t("Edit rules")} title={t("Edit rules")} className={ICON_BUTTON}>
                    <SlidersHorizontal size={17} />
                  </button>
                )}
                <button type="button" onClick={deletePlaylist} aria-label={t("Delete playlist")} title={t("Delete playlist")} className={`${ICON_BUTTON} hover:!bg-red-400/10 hover:!text-red-400`}>
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
        )}
        tracks={reorder || visibleTracks}
        trackNumbers={reorderNumbers || trackNumbers}
        showQuality
        reduceMotion
        onRemove={!smart && !reorder ? removeTrack : null}
        playlistId={!smart ? id : null}
        onReorder={reorder ? ids => setReorder(prev => {
          const byId = new Map(prev.map(track => [track.id, track]))
          return ids.map(trackId => byId.get(trackId)).filter(Boolean)
        }) : null}
        context={playbackContext}
        highlightTrackId={highlightTrackId}
        highlightRequestKey={highlightRequestKey}
      />
      {!!playlistSearch.trim() && !!tracks.length && !visibleTracks.length && (
        <p role="status" className="py-12 text-center text-sm text-muted">{t('No songs match “{query}”.', { query: playlistSearch })}</p>
      )}

      {!isLiked && !smart && tracks.length <= 300 && (tracks.length > 0 || recommendations.length > 0) && (
        <div className="mt-12 mb-6">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-lg font-display text-white">{t('Recommended Songs')}</h2>
            <button
              onClick={fetchRecommendations}
              disabled={loadingRecs}
              aria-label={t('Refresh recommendations')}
              title={t('Refresh recommendations')}
              className="p-2 hover:bg-elevated rounded-full transition-colors text-muted hover:text-white"
            >
              <RefreshCw size={16} className={loadingRecs ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* A new set fades in as a whole instead of its rows popping in. */}
          <motion.div key={recommendations[0]?.id ?? 'none'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
            <TrackList
              tracks={recommendations}
              showQuality
              playlistId={null}
              reduceMotion
              onQuickAdd={!isLiked ? addRecommendation : null}
            />
          </motion.div>
        </div>
      )}

      {loaded && !tracks.length && (
        <div className="text-center py-20 text-muted">
          <Music size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">{isLiked ? t(favorites ? 'Like some tracks to see them here.' : 'Liked Songs are turned off in Settings → Library → Playlists.') : smart ? t('No songs match these rules yet. Use Edit Rules to change them.') : t('This playlist is empty. Add songs to it with “Add to playlist” from any song’s menu.')}</p>
        </div>
      )}

    </div>
  )
}
