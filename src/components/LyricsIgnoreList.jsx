// Lyrics Search's ignore list: songs and artists the search skips without
// asking anything online. A fold-out list (covers for songs, pictures for
// artists) with a remove button on each, confirmed first, and a + opening a
// window to find library songs and artists, tick them and save them to it.
// Kept in the settings (electron/lyrics/bulkSearch.js), so the app export has it.

import React, { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, EyeOff, Loader2, Music, Play, Plus, Search, Trash2, UserRound } from 'lucide-react'
import { api } from '../api'
import Modal from './Modal'
import { useTranslation } from '../i18n'
import { trackArtURL } from '../onlineTracks'
import { usePlayerStore } from '../store/player'

const artistImage = (artist) => (!artist?.image_path ? null
  : api.isElectron ? `file://${artist.image_path}` : artist.id ? `/api/artist-image/${encodeURIComponent(artist.id)}` : null)

const keyOf = (type, item) => (type === 'artist' ? `a:${String(item.name).toLowerCase()}` : `t:${item.id}`)

function Picture({ type, item, size = 'h-9 w-9' }) {
  const src = type === 'artist' ? artistImage(item) : trackArtURL(item)
  const shape = type === 'artist' ? 'rounded-full' : 'rounded-md'
  return (
    <div className={`${size} ${shape} flex-shrink-0 overflow-hidden bg-card`}>
      {src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-subtle">{type === 'artist' ? <UserRound size={15} /> : <Music size={15} />}</div>}
    </div>
  )
}

function Row({ type, item, onRemove }) {
  const { t } = useTranslation()
  return (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
      {type === 'track' && item.track ? (
        // A song still in the library: its cover plays it.
        <button type="button" onClick={() => usePlayerStore.getState().playTrack(item.track, [item.track])}
          title={t('Play')} aria-label={t('Play {title}', { title: item.title })} className="group/play relative flex-shrink-0">
          <Picture type={type} item={item} />
          <span className="absolute inset-0 flex items-center justify-center rounded-md bg-black/55 text-white opacity-0 transition-opacity group-hover/play:opacity-100 group-focus-visible/play:opacity-100">
            <Play size={14} fill="currentColor" />
          </span>
        </button>
      ) : <Picture type={type} item={item} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-white">{type === 'artist' ? item.name : item.title}</p>
        <p className="truncate text-[11px] text-muted">{type === 'artist' ? t('Artist: all of their tracks') : item.artist}</p>
      </div>
      <button onClick={() => onRemove(type, item)} title={t('Remove from the ignore list')} aria-label={t('Remove from the ignore list')}
        className="rounded-lg p-1.5 text-muted opacity-0 transition-opacity hover:bg-white/10 hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

/** The + window: find songs and artists, tick them, save them to the list. */
function AddModal({ open, list, onClose, onSaved }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [found, setFound] = useState({ tracks: [], artists: [] })
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(() => new Map())
  const [saving, setSaving] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    setQuery(''); setFound({ tracks: [], artists: [] }); setPicked(new Map())
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const q = query.trim()
    const mine = ++seq.current
    if (!q) { setFound({ tracks: [], artists: [] }); setSearching(false); return undefined }
    setSearching(true)
    const timer = setTimeout(() => {
      api.lyricsSearchIgnoreSearch(q)
        .then(r => { if (mine === seq.current) setFound({ tracks: r?.tracks || [], artists: r?.artists || [] }) })
        .catch(() => {})
        .finally(() => { if (mine === seq.current) setSearching(false) })
    }, 220)
    return () => clearTimeout(timer)
  }, [query, open])

  const already = new Set([...(list?.tracks || []).map(item => keyOf('track', item)), ...(list?.artists || []).map(item => keyOf('artist', item))])
  const toggle = (type, item) => setPicked(prev => {
    const next = new Map(prev)
    const key = keyOf(type, item)
    if (next.has(key)) next.delete(key)
    else next.set(key, { type, item })
    return next
  })

  const save = async () => {
    if (!picked.size || saving) return
    setSaving(true)
    try {
      const values = [...picked.values()]
      const r = await api.lyricsSearchIgnoreAdd({
        tracks: values.filter(v => v.type === 'track').map(v => v.item.id),
        artists: values.filter(v => v.type === 'artist').map(v => v.item.name),
      })
      onSaved(r)
      onClose()
    } finally { setSaving(false) }
  }

  const section = (type, items, title) => items.length > 0 && (
    <div>
      <p className="px-2 pb-1 pt-2 text-[10px] font-display uppercase tracking-[0.2em] text-subtle">{title}</p>
      {items.map(item => {
        const key = keyOf(type, item)
        const isIn = already.has(key)
        const on = isIn || picked.has(key)
        return (
          <button key={key} type="button" disabled={isIn} onClick={() => toggle(type, item)}
            className="group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04] disabled:cursor-default disabled:opacity-60">
            <Picture type={type} item={item} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-white">{type === 'artist' ? item.name : item.title}</p>
              <p className="truncate text-[11px] text-muted">{type === 'artist' ? t('Artist') : item.artist}{isIn ? ` · ${t('already ignored')}` : ''}</p>
            </div>
            <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border transition-opacity ${on ? 'border-accent bg-accent text-black opacity-100' : 'border-white/30 opacity-0 group-hover:opacity-100'}`}>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={t('Add to the ignore list')} width="max-w-lg">
      <div className="flex h-[min(34rem,calc(100vh-10rem))] flex-col gap-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-accent/50">
          {searching ? <Loader2 size={14} className="animate-spin text-muted" /> : <Search size={14} className="text-muted" />}
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Search tracks or artists')}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-muted" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {section('artist', found.artists, t('Artists'))}
          {section('track', found.tracks, t('Tracks'))}
          {query.trim() && !searching && !found.artists.length && !found.tracks.length && <p className="px-2 py-6 text-center text-xs text-muted">{t('Nothing found')}</p>}
          {!query.trim() && <p className="px-2 py-6 text-center text-xs text-muted">{t('Type a track or artist name, then tick what to ignore.')}</p>}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-xs text-muted hover:text-white">{t('Cancel')}</button>
          <button onClick={save} disabled={!picked.size || saving}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-40">
            {saving && <Loader2 size={12} className="animate-spin" />} {t('Save')}{picked.size ? ` (${picked.size})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function LyricsIgnoreList() {
  const { t } = useTranslation()
  const [list, setList] = useState({ tracks: [], artists: [] })
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(null) // { type, item }
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.lyricsSearchIgnoreGet().then(r => r && !r.error && setList(r)).catch(() => {}) }, [])

  const count = list.tracks.length + list.artists.length
  const remove = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const r = await api.lyricsSearchIgnoreRemove(removing.type === 'artist' ? { type: 'artist', name: removing.item.name } : { type: 'track', id: removing.item.id })
      if (r && !r.error) setList(r)
      setRemoving(null)
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-xl rounded-xl border border-border bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-white">
          {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
          <EyeOff size={14} className="text-muted" />
          <span className="truncate">{t('Ignore list')}</span>
          <span className="text-xs tabular-nums text-muted">{count}</span>
        </button>
        {open && (
          <button type="button" onClick={() => setAdding(true)} title={t('Add tracks or artists')} aria-label={t('Add tracks or artists')}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-white/10 hover:text-accent">
            <Plus size={15} />
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-80 overflow-y-auto border-t border-border/60 px-1 py-1">
          {!count && <p className="px-2 py-3 text-xs text-muted">{t('Nothing is ignored. Tracks and artists added here are skipped by the search, with no requests online.')}</p>}
          {list.artists.map(item => <Row key={keyOf('artist', item)} type="artist" item={item} onRemove={(type, it) => setRemoving({ type, item: it })} />)}
          {list.tracks.map(item => <Row key={keyOf('track', item)} type="track" item={item} onRemove={(type, it) => setRemoving({ type, item: it })} />)}
        </div>
      )}

      <AddModal open={adding} list={list} onClose={() => setAdding(false)} onSaved={r => r && !r.error && setList(r)} />
      <Modal open={!!removing} onClose={busy ? undefined : () => setRemoving(null)} title={t('Remove from the ignore list')} width="max-w-md">
        <p className="text-sm leading-relaxed text-white/80">
          {removing?.type === 'artist'
            ? t('Remove {name} from the ignore list? Their tracks will be searched for lyrics again.', { name: removing.item.name })
            : t('Remove “{title}” from the ignore list? It will be searched for lyrics again.', { title: removing?.item?.title || '' })}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setRemoving(null)} disabled={busy} className="rounded-xl border border-border px-4 py-2 text-xs text-muted hover:text-white disabled:opacity-50">{t('Back')}</button>
          <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-red-500/90 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50">
            {busy && <Loader2 size={12} className="animate-spin" />} {t('Remove')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
