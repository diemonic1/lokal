// "Lokal.exe play_track <name>" (electron/main.js): the song with that file
// name or title is looked up in the library (electron/commandLineTrack.js);
// found, the Library opens on its folder and it plays from there, in the
// folder's order. Not found, nothing plays. Inside the router, to navigate.

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { usePlayerStore } from '../store/player'
import { setLibraryFolder } from '../libraryNav'
import { revealPlayingInLibrary } from '../pages/Library'
import { showToast } from './Toaster'
import { translate } from '../i18n'

// The Library's own sort (its "sort" choice), so the queue is the list on screen.
function librarySort() {
  try { const saved = JSON.parse(localStorage.getItem('lokal-library-sort')); if (typeof saved === 'string' && saved) return saved } catch {}
  return 'track_num DESC'
}

export default function CommandLinePlayTrack() {
  // Kept in a ref: navigate changes with the page, and the listener stays put.
  const navigateRef = useRef(null)
  navigateRef.current = useNavigate()
  useEffect(() => {
    if (!api.isElectron || !window.electron?.onRemoteCommand) return undefined
    const off = window.electron.onRemoteCommand(async (command) => {
      if (command?.action !== 'playTrack') return
      const name = String(command.value || '').trim()
      const found = name ? await Promise.resolve(window.electron.findTrackForCommand?.(name)).catch(() => null) : null
      if (!found?.track) {
        api.log('warn', `play_track: no song called "${name}"`)
        showToast(translate('No song called “{name}”', { name }))
        return
      }
      const { track, folder } = found
      const list = await Promise.resolve(api.getTracks({ ...(folder ? { folder } : {}), sort: librarySort(), limit: 5000 })).catch(() => null)
      const queue = Array.isArray(list) && list.some(item => item.id === track.id) ? list : [track]
      revealPlayingInLibrary()
      setLibraryFolder(folder)
      navigateRef.current('/library')
      usePlayerStore.getState().playTrack(track, queue)
    })
    // Listening now: commands the app was started with come in.
    window.electron.remoteReady?.()
    return off
  }, [])
  return null
}
