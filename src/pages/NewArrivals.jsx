// The New tab: what joined the library lately (tracks.added_at, see
// electron/newArrivals.js). Recently added, then the last week, month and
// year, then the last month's songs by genre -- each list five songs long
// until "Show all" -- and at the bottom the artists new to the library.
// It took Home's "Recently Added".

import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Clock, Sparkles, Tags, Users } from 'lucide-react'
import { usePlayerStore } from '../store/player'
import { api } from '../api'
import { useCachedState, usePageReady } from '../pageCache'
import TrackList from '../components/TrackList'
import { ArtistCard } from './Artists'
import { useTranslation } from '../i18n'

const PREVIEW = 5
const DAY = 86400

/** The month's songs grouped by their genres: [{ name, tracks }], biggest first. */
export function genreGroups(tracks) {
  const groups = new Map()
  for (const track of tracks) {
    const seen = new Set()
    for (const source of [track?.genres, track?.genre]) {
      for (const part of String(source || '').split(/[,;/]/)) {
        const name = part.trim()
        const key = name.toLowerCase()
        if (!name || seen.has(key)) continue
        seen.add(key)
        if (!groups.has(key)) groups.set(key, { name, tracks: [] })
        groups.get(key).tracks.push(track)
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name))
}

function TrackSection({ icon: Icon, title, tracks, context }) {
  const { t } = useTranslation()
  const playQueue = usePlayerStore(s => s.playQueue)
  const [open, setOpen] = useState(false)
  if (!tracks.length) return null
  const shown = open ? tracks : tracks.slice(0, PREVIEW)
  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-accent" />}
        <h2 className="text-xs font-display uppercase tracking-widest text-muted">{title}</h2>
        <span className="text-xs text-muted/70">{tracks.length}</span>
        <div className="ml-auto flex items-center gap-4">
          <button onClick={() => playQueue(tracks, 0, context)} className="text-xs text-accent hover:text-accent/70">{t('Play All')}</button>
          {tracks.length > PREVIEW && (
            <button onClick={() => setOpen(value => !value)} className="text-xs text-muted transition-colors hover:text-white">
              {open ? t('Hide') : t('Show all')}
            </button>
          )}
        </div>
      </div>
      <TrackList tracks={shown} reduceMotion context={context} />
    </section>
  )
}

export default function NewArrivals() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const playQueue = usePlayerStore(s => s.playQueue)
  const [data, setData] = useCachedState('new-arrivals', null)
  const [loaded, setLoaded] = useState(!!data)
  useEffect(() => {
    let alive = true
    Promise.resolve(api.getNewArrivals()).then(result => {
      if (alive && result && !result.error) setData(result)
    }).catch(() => {}).finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  usePageReady(loaded)

  const { recent, week, month, year, genres, artists } = useMemo(() => {
    const now = data?.now || Math.floor(Date.now() / 1000)
    const yearTracks = Array.isArray(data?.year) ? data.year : []
    const since = days => yearTracks.filter(track => Number(track.added_at) >= now - days * DAY)
    const monthTracks = since(30)
    return {
      recent: Array.isArray(data?.recent) ? data.recent : [],
      week: since(7),
      month: monthTracks,
      year: yearTracks,
      genres: genreGroups(monthTracks),
      artists: Array.isArray(data?.newArtists) ? data.newArtists : [],
    }
  }, [data])

  const playArtist = async (artist) => {
    const result = await api.getArtist(artist.id)
    const tracks = Array.isArray(result?.tracks) && result.tracks.length ? result.tracks : (Array.isArray(result?.topTracks) ? result.topTracks : [])
    if (tracks.length) playQueue(tracks, 0)
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 p-6 pb-10">
      <div>
        <h1 className="text-2xl font-display text-white">{t('New Arrivals')}</h1>
        <p className="mt-1 text-sm text-muted">{t('What joined your library lately')}</p>
      </div>
      <TrackSection icon={Sparkles} title={t('Recently Added')} tracks={recent} context={{ type: 'new-arrivals', name: 'Recently Added' }} />
      <TrackSection icon={Clock} title={t('Added this week')} tracks={week} context={{ type: 'new-arrivals', name: 'Added this week' }} />
      <TrackSection icon={CalendarDays} title={t('Added this month')} tracks={month} context={{ type: 'new-arrivals', name: 'Added this month' }} />
      <TrackSection icon={CalendarDays} title={t('Added this year')} tracks={year} context={{ type: 'new-arrivals', name: 'Added this year' }} />
      {genres.length > 0 && (
        <div className="space-y-8">
          <div className="flex items-center gap-2 border-t border-border pt-8">
            <Tags size={16} className="text-accent" />
            <h2 className="text-lg font-display text-white">{t('New by genre')}</h2>
          </div>
          {genres.map(group => (
            <TrackSection key={group.name} title={group.name} tracks={group.tracks} context={{ type: 'new-arrivals', name: group.name }} />
          ))}
        </div>
      )}
      {artists.length > 0 && (
        <section className="space-y-4 border-t border-border pt-8">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-accent" />
            <h2 className="text-lg font-display text-white">{t('New artists')}</h2>
            <span className="text-xs text-muted/70">{artists.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-6">
            {artists.map(artist => (
              <ArtistCard key={artist.id} artist={artist}
                onClick={() => navigate(`/artist/${artist.id}`)}
                onPlay={() => playArtist(artist)} />
            ))}
          </div>
        </section>
      )}
      {loaded && !recent.length && <p className="py-10 text-center text-sm text-muted">{t('No local tracks yet. Pick your music folder in Library.')}</p>}
    </div>
  )
}
