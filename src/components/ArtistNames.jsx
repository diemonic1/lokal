import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { trackArtistParts, navigateToArtistName } from '../artistLink'
import { useTranslation } from '../i18n'

// The user's "keep the comma" artists, read once for every list on screen
// and refreshed when Settings changes them.
let keepCommaCache = null
let keepCommaRequest = null
const keepCommaListeners = new Set()

function loadKeepComma() {
  if (keepCommaRequest) return keepCommaRequest
  keepCommaRequest = Promise.resolve(api.getKeepCommaArtists()).then(result => {
    let list = Array.isArray(result) ? result : []
    if (!Array.isArray(result) && result?.value) { try { list = JSON.parse(result.value) } catch {} }
    keepCommaCache = list
    keepCommaListeners.forEach(listener => listener(list))
    return list
  }).catch(() => [])
  return keepCommaRequest
}

if (typeof window !== 'undefined') {
  window.addEventListener('lokal:comma-artists-updated', (event) => {
    if (!Array.isArray(event.detail)) return
    keepCommaCache = event.detail
    keepCommaListeners.forEach(listener => listener(event.detail))
  })
}

export function useKeepCommaArtists() {
  const [list, setList] = useState(keepCommaCache || [])
  useEffect(() => {
    keepCommaListeners.add(setList)
    if (!keepCommaCache) loadKeepComma()
    return () => { keepCommaListeners.delete(setList) }
  }, [])
  return list
}

/**
 * A track's credit with each artist a link to their page. "A (feat. B)" and
 * "A & B" read as tagged; "A/B", "A\B" and "A;B" read "A, B". A click
 * doesn't reach the row under it; onNavigate runs first (the full-screen
 * player closes itself).
 */
export default function ArtistNames({ track, className = '', linkClassName = 'hover:text-accent hover:underline', onContextMenu, onNavigate, disabled = false }) {
  const { t } = useTranslation()
  const nav = useNavigate()
  const keepComma = useKeepCommaArtists()
  const parts = trackArtistParts(track, keepComma)
  if (!parts.length) return null
  const text = parts.map(part => part.text).join('')
  return (
    <span className={className} title={text} onContextMenu={onContextMenu}>
      {parts.map(({ text: piece, artist: name }, index) => (
        <React.Fragment key={index}>
          {!name || disabled ? piece : (
            <button type="button" className={`inline transition-colors ${linkClassName}`}
              title={t('Go to artist: {artist}', { artist: name })}
              onClick={(event) => { event.stopPropagation(); onNavigate?.(); navigateToArtistName(nav, track, name) }}
              onDoubleClick={event => event.stopPropagation()}>
              {name}
            </button>
          )}
        </React.Fragment>
      ))}
    </span>
  )
}
