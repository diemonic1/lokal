// The tab strip under the title bar and the folder picked in the left sidebar,
// both remembered across launches.

import { useEffect, useState } from 'react'
import { Home, Library, BarChart2, Disc3, Users, AudioWaveform, Clapperboard, ScrollText } from 'lucide-react'

export const TABS = [
  { icon: Home, label: 'Home', path: '/' },
  { icon: Library, label: 'Library', path: '/library', tour: 'library' },
  { icon: BarChart2, label: 'Recap', path: '/recap' },
  { icon: Disc3, label: 'Albums', path: '/albums', tour: 'albums' },
  { icon: Users, label: 'Artists', path: '/artists', tour: 'artists' },
  { icon: Clapperboard, label: 'Videos', path: '/videos' },
  { icon: AudioWaveform, label: 'Audio Quality', path: '/quality' },
  { icon: ScrollText, label: 'Lyrics Analysis', path: '/lyrics-analysis' },
]

const TAB_KEY = 'lokal-last-tab'
const FOLDER_KEY = 'lokal-library-folder'
const FOLDER_EVENT = 'lokal:library-folder'

/** The tab a page belongs to, or null (Settings, Search, a playlist…). */
export function tabForPath(pathname) {
  if (pathname === '/' || pathname.startsWith('/home/')) return '/'
  if (pathname === '/artists' || pathname.startsWith('/artist/')) return '/artists'
  return TABS.some(tab => tab.path === pathname) ? pathname : null
}

/** Where the app opens: the tab open last time, Library the first time. */
export function initialTabPath() {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved && TABS.some(tab => tab.path === saved)) return saved
  } catch {}
  return '/library'
}

export function rememberTab(path) {
  try { localStorage.setItem(TAB_KEY, path) } catch {}
}

const readFolder = () => { try { return localStorage.getItem(FOLDER_KEY) || '' } catch { return '' } }

export function setLibraryFolder(path) {
  try { localStorage.setItem(FOLDER_KEY, path || '') } catch {}
  window.dispatchEvent(new CustomEvent(FOLDER_EVENT, { detail: path || '' }))
}

/** The folder picked in the sidebar (relative to the music folder), '' before any. */
export function useLibraryFolder() {
  const [folder, setFolder] = useState(readFolder)
  useEffect(() => {
    const onChange = event => setFolder(event.detail || '')
    window.addEventListener(FOLDER_EVENT, onChange)
    return () => window.removeEventListener(FOLDER_EVENT, onChange)
  }, [])
  return folder
}
