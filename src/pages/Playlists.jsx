import React, { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Heart, Play, Plus, Sparkles, Edit2, Image as ImageIcon, X, Trash2, SlidersHorizontal, ExternalLink, ListMusic } from 'lucide-react'
import { usePlayerStore, useAppStore } from '../store/player'
import PlaylistCover from '../components/PlaylistCover'
import ContextMenu, { useContextMenu } from '../components/ContextMenu'
import Modal from '../components/Modal'
import { showToast } from '../components/Toaster'
import { api } from '../api'
import { openSmartPlaylistEditor } from '../smartPlaylists'
import { makePlaylistContext } from '../playbackContext'
import { isPlayable } from '../onlineTracks'
import { plural } from '../plural'
import { usePageReady } from '../pageCache'
import { useFavoritesEnabled } from '../appearanceFlags'
import { useTranslation } from '../i18n'

// The Playlists tab: every playlist from the music folder's Playlists folder
// (electron/playlistFiles.js), the favourites first, and the smart ones.
// Right-click one to rename it, change its picture or delete it.

const FIELD = 'w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-white outline-none focus:border-accent/60 placeholder:text-muted/60'
const BUTTON = 'rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-40'

/** A playlist's name to type: a new playlist, or a new name for one. */
function NameDialog({ open, title, initial = '', confirm, onSubmit, onClose }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  useEffect(() => { if (open) setValue(initial) }, [open, initial])
  const submit = () => { if (value.trim()) onSubmit(value.trim()) }
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <input autoFocus value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => event.key === 'Enter' && submit()}
          placeholder={t('Playlist name')} aria-label={t('Playlist name')} className={FIELD} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${BUTTON} text-muted hover:text-white`}>{t('Cancel')}</button>
          <button type="button" onClick={submit} disabled={!value.trim()} className={`${BUTTON} bg-accent text-[rgb(var(--bg-rgb))] hover:bg-accent/80`}>{confirm}</button>
        </div>
      </div>
    </Modal>
  )
}

export default function Playlists() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { user } = useAppStore()
  const playQueue = usePlayerStore(state => state.playQueue)
  const favorites = useFavoritesEnabled()
  const menu = useContextMenu()
  const [playlists, setPlaylists] = useState([])
  const [likedCount, setLikedCount] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // { kind: 'create' } | { kind: 'rename', playlist } | { kind: 'delete', playlist }
  const [dialog, setDialog] = useState(null)
  usePageReady(loaded)

  const load = useCallback(() => {
    const lists = Promise.resolve(api.getPlaylists(user?.id)).then(result => setPlaylists(Array.isArray(result) ? result : []))
    const liked = Promise.resolve(api.getPlaylistTracks('liked')).then(result => setLikedCount(Array.isArray(result) ? result.length : 0))
    Promise.allSettled([lists, liked]).then(() => setLoaded(true))
  }, [user?.id])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const events = ['lokal:playlists-changed', 'lokal:playlist-updated', 'lokal:playlist-created', 'lokal:playlist-deleted', 'lokal:refresh']
    events.forEach(name => window.addEventListener(name, load))
    return () => events.forEach(name => window.removeEventListener(name, load))
  }, [load])

  const changed = (playlistId) => window.dispatchEvent(new CustomEvent('lokal:playlists-changed', { detail: { playlistId } }))
  const failed = (result) => { if (result?.error) { showToast(t(result.error)); return true } return false }

  const play = async (playlist) => {
    const id = playlist ? playlist.id : 'liked'
    const tracks = (await Promise.resolve(api.getPlaylistTracks(id)).catch(() => [])) || []
    const playable = tracks.filter(track => isPlayable(track))
    if (!playable.length) { showToast(t('This playlist is empty.')); return }
    playQueue(playable, 0, makePlaylistContext(playlist || { id: 'liked', name: 'Liked Songs' }, id))
  }

  const create = async (name) => {
    const playlist = await api.createPlaylist(name, user?.id)
    if (failed(playlist)) return
    setDialog(null)
    changed(playlist?.id)
    if (playlist?.id) nav(`/playlist/${playlist.id}`)
  }

  const rename = async (playlist, name) => {
    if (failed(await api.updatePlaylist(playlist.id, { name }))) return
    setDialog(null)
    changed(playlist.id)
  }

  const changeCover = async (playlist) => {
    const file = await api.openFile([{ name: t('Images'), extensions: ['jpg', 'jpeg', 'png', 'webp'] }])
    if (!file) return
    const dataUrl = await api.readFileAsDataURL(file)
    if (!dataUrl || failed(await api.updatePlaylist(playlist.id, { coverData: dataUrl }))) return
    changed(playlist.id)
  }

  const clearCover = async (playlist) => {
    if (failed(await api.updatePlaylist(playlist.id, { clearCover: true }))) return
    changed(playlist.id)
  }

  const remove = async (playlist) => {
    if (failed(await api.deletePlaylist(playlist.id))) return
    setDialog(null)
    window.dispatchEvent(new CustomEvent('lokal:playlist-deleted', { detail: { playlistId: playlist.id } }))
  }

  const openMenu = (event, playlist) => {
    const smart = !!playlist?.smart_rules
    menu.open(event, [
      { label: t('Play'), icon: Play, onSelect: () => play(playlist) },
      { label: t('Open'), icon: ExternalLink, onSelect: () => nav(`/playlist/${playlist ? playlist.id : 'liked'}`) },
      playlist && { separator: true },
      playlist && { label: t('Rename'), icon: Edit2, onSelect: () => setDialog({ kind: 'rename', playlist }) },
      playlist && api.isElectron && { label: t('Change picture'), icon: ImageIcon, onSelect: () => changeCover(playlist) },
      playlist?.cover_path && { label: t('Remove picture'), icon: X, onSelect: () => clearCover(playlist) },
      smart && { label: t('Edit rules'), icon: SlidersHorizontal, onSelect: () => openSmartPlaylistEditor(playlist) },
      playlist && { separator: true },
      playlist && { label: t('Delete playlist'), icon: Trash2, danger: true, onSelect: () => setDialog({ kind: 'delete', playlist }) },
    ])
  }

  const tile = (key, cover, name, subtitle, onOpen, onMenu, onPlay) => (
    <button key={key} type="button" onClick={onOpen} onContextMenu={onMenu}
      className="group flex flex-col gap-3 rounded-xl border border-border bg-elevated p-3 text-left transition-colors hover:border-accent/30">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-card">
        {cover}
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
          <span role="button" tabIndex={-1} aria-label={t('Play')}
            onClick={event => { event.stopPropagation(); onPlay() }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-accent shadow-xl">
            <Play size={16} fill="currentColor" className="translate-x-0.5 text-[rgb(var(--bg-rgb))]" />
          </span>
        </div>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{name}</p>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
    </button>
  )

  const deleting = dialog?.kind === 'delete' ? dialog.playlist : null

  return (
    <div className="min-h-full p-6 pb-10">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 @md:flex-row @md:items-end @md:justify-between">
          <div>
            <p className="text-[11px] font-display uppercase tracking-[0.32em] text-muted">{t('Collection')}</p>
            <h1 className="mt-2 font-display text-3xl uppercase tracking-[0.14em] text-white">{t('Playlists')}</h1>
            <p className="mt-3 text-sm text-muted">{loaded ? plural(playlists.length + (favorites ? 1 : 0), 'playlist') : ' '}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDialog({ kind: 'create' })}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-[rgb(var(--bg-rgb))] transition-colors hover:bg-accent/80">
              <Plus size={15} /> {t('New playlist')}
            </button>
            <button type="button" onClick={() => openSmartPlaylistEditor()}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-white transition-colors hover:border-accent/50">
              <Sparkles size={15} /> {t('New smart playlist')}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3 @lg:grid-cols-5 @xl:grid-cols-6">
          {favorites && tile('liked',
            <div className="flex h-full w-full items-center justify-center bg-accent/10"><Heart size={48} className="text-accent" fill="currentColor" /></div>,
            t('Liked Songs'), plural(likedCount, 'track'),
            () => nav('/playlist/liked'), event => openMenu(event, null), () => play(null))}
          {playlists.map(playlist => tile(playlist.id,
            <PlaylistCover playlistId={playlist.id} coverPath={playlist.cover_path} size={256} className="!h-full !w-full" />,
            playlist.name,
            playlist.smart_rules ? t('Smart playlist') : plural(playlist.track_count || 0, 'track'),
            () => nav(`/playlist/${playlist.id}`), event => openMenu(event, playlist), () => play(playlist)))}
        </div>

        {loaded && !playlists.length && !favorites && (
          <div className="py-16 text-center text-muted">
            <ListMusic size={40} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">{t('No playlists yet. Make one with “New playlist”, or add songs with “Add to playlist” from any song’s menu.')}</p>
          </div>
        )}
      </div>

      <ContextMenu menu={menu} />
      <NameDialog open={dialog?.kind === 'create'} title={t('New playlist')} confirm={t('Create')} onSubmit={create} onClose={() => setDialog(null)} />
      <NameDialog open={dialog?.kind === 'rename'} title={t('Rename playlist')} initial={dialog?.playlist?.name || ''} confirm={t('Save')}
        onSubmit={name => rename(dialog.playlist, name)} onClose={() => setDialog(null)} />
      <Modal open={!!deleting} onClose={() => setDialog(null)} title={t('Delete playlist')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('Delete “{name}”? Its file is removed from the Playlists folder on every synced device. The songs stay in your library.', { name: deleting?.name || '' })}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className={`${BUTTON} text-muted hover:text-white`}>{t('Cancel')}</button>
            <button type="button" onClick={() => remove(deleting)} className={`${BUTTON} bg-red-500/80 text-white hover:bg-red-500`}>{t('Delete')}</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
