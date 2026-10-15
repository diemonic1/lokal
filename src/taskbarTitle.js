// The window title, which Windows shows on the app's taskbar button:
// Settings > Appearance > Taskbar > Taskbar title (the `taskbar_title`
// setting). Without a track playing it's the app's name.

import { useEffect } from 'react'
import { usePlayerStore } from './store/player'
import { useAppearanceText } from './appearanceFlags'

const APP_NAME = 'Lokal Music'
const DASH = ' – '

export function taskbarTitle(mode, track) {
  const title = String(track?.title || '').trim()
  const artist = String(track?.artist || '').trim()
  if (!track || mode === 'app') return APP_NAME
  // Windows' taskbar cuts a title at " - " (hyphen), taking the rest for the
  // app's name, so the two are joined with an en dash, which it leaves alone.
  const text = mode === 'artist' ? artist
    : mode === 'artist-title' ? [artist, title].filter(Boolean).join(DASH)
      : mode === 'title-artist' ? [title, artist].filter(Boolean).join(DASH)
        : title
  return text || APP_NAME
}

export function useTaskbarTitle() {
  const mode = useAppearanceText('taskbar_title', 'title')
  const track = usePlayerStore(s => s.currentTrack)
  const text = taskbarTitle(mode, track)
  useEffect(() => { document.title = text }, [text])
}
