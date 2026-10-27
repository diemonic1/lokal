// A song's moving-cover marks, as its row has them (tracks.spotify_canvas and
// tracks.motion_cover_source, see electron/artwork/motion.js): Spotify's logo
// when it has a Spotify Canvas, and a moving-cover icon when the moving cover
// it played with came from elsewhere (Apple Music, Tidal, the community
// list), each saying so on hover.

import React from 'react'
import { ImagePlay } from 'lucide-react'
import { useTranslation } from '../i18n'
import SpotifyIcon from './SpotifyIcon'

export default function MotionCoverMarks({ spotify, source, size = 13, className = '' }) {
  const { t } = useTranslation()
  const other = source && source !== 'spotify'
    ? ({ apple: t('Moving cover from Apple Music'), tidal: t('Moving cover from Tidal'), community: t('Moving cover from the community list') }[source] || t('Moving cover'))
    : null
  if (!spotify && !other) return null
  return (
    <span className={`flex items-center gap-1 ${className}`}>
      {spotify && (
        <span className="flex cursor-help items-center" title={t('This track has a Spotify Canvas')} aria-label={t('This track has a Spotify Canvas')}>
          <SpotifyIcon size={size} />
        </span>
      )}
      {other && (
        <span className="flex cursor-help items-center text-accent" title={other} aria-label={other}>
          <ImagePlay size={size} />
        </span>
      )}
    </span>
  )
}
