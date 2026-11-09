import React, { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Heart, Music, Tags } from 'lucide-react'
import { api } from '../api'
import FadeImg from './FadeImg'
import PlaylistCover from './PlaylistCover'
import { peekCache, writeCache } from '../pageCache'
import { useAppStore } from '../store/player'
import { useFavoritesEnabled } from '../appearanceFlags'
import { useDiscoveryArtists } from '../discoveryArtists'
import { useTranslation } from '../i18n'

// The left sidebar on the Genres, Artists and Playlists tabs: the tab's own
// genres, artists or playlists, with the pictures and in the order the tab's
// page shows them (instead of the music folders). The one open is marked; a
// click opens another.

// Songs without any genre (Genres.jsx's NO_GENRE, kept here so the sidebar
// doesn't load the Genres page with it).
const NO_GENRE = '__none__'

// The Artists page tells which list it shows (sort, All / Followed) when it changes.
export const ARTISTS_VIEW_EVENT = 'lokal:artists-view'
export function artistsView() {
  let sort = 'tracks'
  let followed = false
  try {
    sort = localStorage.getItem('lokal-artists-sort') || 'tracks'
    followed = localStorage.getItem('lokal-artists-followed') === '1'
  } catch {}
  return { sort, followed }
}

const artURL = item => (api.isElectron ? `file://${item.artwork_path}` : api.artworkURL(item.track_id))

function artistImage(artist) {
  if (!artist?.image_path) return null
  const version = artist.image_fetched_at ? `?v=${artist.image_fetched_at}` : ''
  return api.isElectron ? `file://${artist.image_path}${version}` : `/api/artist-image/${encodeURIComponent(artist.id)}${version}`
}

function hue(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) { hash = (hash << 5) - hash + str.charCodeAt(i); hash |= 0 }
  return Math.abs(hash) % 360
}

/** The Artists page's avatar: the picture, or the name's colours and first letter. */
function ArtistIcon({ artist, size }) {
  const src = artistImage(artist)
  if (src) return <FadeImg src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
  const h = hue(artist.name || '?')
  return (
    <div className="flex h-full w-full items-center justify-center text-white/85"
      style={{ background: `linear-gradient(140deg, hsl(${h}, 62%, 40%) 0%, hsl(${(h + 50) % 360}, 68%, 26%) 100%)`, fontSize: Math.round(size * 0.42) }}>
      <span className="font-display uppercase">{(artist.name || '?').trim().charAt(0) || '?'}</span>
    </div>
  )
}

/** The Genres page's cover: four of its songs' covers, one, or the tag. */
function GenreIcon({ artworks, size }) {
  if (!artworks?.length) return <Tags size={Math.round(size * 0.45)} className="text-muted" />
  if (artworks.length < 4) return <FadeImg src={artURL(artworks[0])} alt="" loading="lazy" className="h-full w-full object-cover" />
  return (
    <div className="grid h-full w-full grid-cols-2 grid-rows-2">
      {artworks.slice(0, 4).map(item => <FadeImg key={item.track_id} src={artURL(item)} alt="" loading="lazy" className="h-full w-full object-cover" />)}
    </div>
  )
}

function useGenres() {
  const [summary, setSummary] = useState(() => peekCache('genres:summary') || null)
  useEffect(() => {
    let alive = true
    const load = () => Promise.resolve(api.getGenreSummary()).then(result => {
      if (!alive || !result || result.error) return
      writeCache('genres:summary', result)
      setSummary(result)
    }).catch(() => {})
    load()
    window.addEventListener('lokal:refresh', load)
    return () => { alive = false; window.removeEventListener('lokal:refresh', load) }
  }, [])
  return summary
}

// The server hands artists out 200 at a time: all of them, page by page.
const ARTIST_PAGE = 200
function useArtists() {
  const [view, setView] = useState(artistsView)
  const cacheKey = `sidebar:artists:${view.sort}${view.followed ? ':followed' : ''}`
  const [artists, setArtists] = useState(() => peekCache(cacheKey) || [])
  const followed = useDiscoveryArtists(state => state.followed)
  useEffect(() => {
    const onView = () => setView(current => {
      const next = artistsView()
      return next.sort === current.sort && next.followed === current.followed ? current : next
    })
    window.addEventListener(ARTISTS_VIEW_EVENT, onView)
    return () => window.removeEventListener(ARTISTS_VIEW_EVENT, onView)
  }, [])
  useEffect(() => {
    let alive = true
    const seen = peekCache(cacheKey)
    if (seen) setArtists(seen)
    const load = async () => {
      const all = []
      for (let offset = 0; alive; offset += ARTIST_PAGE) {
        const result = await Promise.resolve(api.getArtistsPage({ search: '', limit: ARTIST_PAGE, offset, sort: view.sort, followed: view.followed })).catch(() => null)
        if (!Array.isArray(result?.items)) return
        all.push(...result.items)
        if (!result.hasMore || !result.items.length) break
      }
      if (!alive) return
      writeCache(cacheKey, all)
      setArtists(all)
    }
    load()
    window.addEventListener('lokal:refresh', load)
    return () => { alive = false; window.removeEventListener('lokal:refresh', load) }
    // Following someone changes the Followed list.
  }, [cacheKey, view.followed ? followed : null]) // eslint-disable-line react-hooks/exhaustive-deps
  return artists
}

function usePlaylists() {
  const { user } = useAppStore()
  const [playlists, setPlaylists] = useState(() => peekCache('sidebar:playlists') || [])
  useEffect(() => {
    let alive = true
    const load = () => Promise.resolve(api.getPlaylists(user?.id)).then(result => {
      if (!alive || !Array.isArray(result)) return
      writeCache('sidebar:playlists', result)
      setPlaylists(result)
    }).catch(() => {})
    load()
    const events = ['lokal:playlists-changed', 'lokal:playlist-updated', 'lokal:playlist-created', 'lokal:playlist-deleted', 'lokal:refresh']
    events.forEach(name => window.addEventListener(name, load))
    return () => { alive = false; events.forEach(name => window.removeEventListener(name, load)) }
  }, [user?.id])
  return playlists
}

/** One entry, drawn like a music folder in the sidebar. */
function Entry({ active, label, collapsed, scale, cover, round, onOpen, icon }) {
  const ref = useRef(null)
  // The entry open comes into view in the sidebar (opened from the page, or on the way back).
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? 'page' : undefined}
      style={{ fontSize: `${0.75 * scale}rem`, gap: `${0.625 * scale}rem`, contentVisibility: 'auto', containIntrinsicSize: `auto ${cover + 12}px` }}
      className={`w-full flex items-center py-1.5 rounded-lg transition-all ${collapsed ? 'justify-center px-0' : 'px-2'} ${active ? 'bg-accent/15 text-accent' : 'text-muted hover:text-white hover:bg-elevated'}`}
    >
      <div className={`flex flex-shrink-0 items-center justify-center overflow-hidden bg-elevated ${round ? 'rounded-full' : 'rounded'}`} style={{ width: cover, height: cover }}>
        {icon}
      </div>
      {!collapsed && <span className="min-w-0 flex-1 truncate text-left font-medium" title={label}>{label}</span>}
    </button>
  )
}

function GenreList({ collapsed, scale, cover }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const summary = useGenres()
  const open = pathname.startsWith('/genre/') ? decodeURIComponent(pathname.slice('/genre/'.length)) : null
  const go = name => nav(`/genre/${encodeURIComponent(name)}`)
  return (<>
    {(summary?.genres || []).map(item => (
      <Entry key={item.name} active={open === item.name} label={item.name} collapsed={collapsed} scale={scale} cover={cover}
        onOpen={() => go(item.name)} icon={<GenreIcon artworks={item.artworks} size={cover} />} />
    ))}
    {summary?.none > 0 && (
      <Entry active={open === NO_GENRE} label={t('No genre')} collapsed={collapsed} scale={scale} cover={cover}
        onOpen={() => go(NO_GENRE)} icon={<GenreIcon artworks={[]} size={cover} />} />
    )}
  </>)
}

function ArtistList({ collapsed, scale, cover }) {
  const nav = useNavigate()
  const { pathname } = useLocation()
  const artists = useArtists()
  // /artist/<id>, or /artist/<name> from a song's "Go to artist".
  const open = pathname.startsWith('/artist/') ? decodeURIComponent(pathname.slice('/artist/'.length)) : null
  const openName = open?.toLocaleLowerCase()
  return artists.map(artist => (
    <Entry key={artist.id} active={open != null && (String(artist.id) === open || String(artist.name || '').toLocaleLowerCase() === openName)} label={artist.name} collapsed={collapsed} scale={scale} cover={cover} round
      onOpen={() => nav(`/artist/${artist.id}`)} icon={<ArtistIcon artist={artist} size={cover} />} />
  ))
}

function PlaylistList({ collapsed, scale, cover }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const favorites = useFavoritesEnabled()
  const playlists = usePlaylists()
  const open = pathname.startsWith('/playlist/') ? decodeURIComponent(pathname.slice('/playlist/'.length)) : null
  return (<>
    {favorites && (
      <Entry active={open === 'liked'} label={t('Liked Songs')} collapsed={collapsed} scale={scale} cover={cover}
        onOpen={() => nav('/playlist/liked')}
        icon={<div className="flex h-full w-full items-center justify-center bg-accent/10"><Heart size={Math.round(cover * 0.45)} className="text-accent" fill="currentColor" /></div>} />
    )}
    {playlists.map(playlist => (
      <Entry key={playlist.id} active={open != null && String(playlist.id) === open} label={playlist.name} collapsed={collapsed} scale={scale} cover={cover}
        onOpen={() => nav(`/playlist/${playlist.id}`)}
        icon={<PlaylistCover playlistId={playlist.id} coverPath={playlist.cover_path} size={cover} className="!rounded-none" />} />
    ))}
    {!favorites && !playlists.length && (
      <div className="flex justify-center py-4 text-muted/50"><Music size={Math.round(16 * scale)} /></div>
    )}
  </>)
}

/** The list for the tab ('/genres', '/artists', '/playlists'). */
export default function SidebarCollections({ tab, collapsed, scale, cover }) {
  const props = { collapsed, scale, cover }
  if (tab === '/genres') return <GenreList {...props} />
  if (tab === '/artists') return <ArtistList {...props} />
  if (tab === '/playlists') return <PlaylistList {...props} />
  return null
}

export const SIDEBAR_COLLECTION_TABS = ['/genres', '/artists', '/playlists']
