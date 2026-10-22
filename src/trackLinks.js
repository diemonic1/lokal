// "Search on YouTube / Genius / BeatSaver", "Open comment" and "Open music
// video" in a song's right-click menu: the searches look for "Artist - Title"
// (from its tags) on the site, in the system's default browser.

import { api } from './api'
import { clipOpenUrl } from './clipVideo'
import { BeatSaverMark, GeniusMark, YoutubeMark } from './components/ServiceIcons'

export const TRACK_SEARCH_SITES = [
  { key: 'youtube', label: 'Search on YouTube', icon: YoutubeMark, url: 'https://www.youtube.com/results?search_query=%s' },
  { key: 'genius', label: 'Search on Genius', icon: GeniusMark, url: 'https://genius.com/search?q=%s' },
  { key: 'beatsaver', label: 'Search on BeatSaver', icon: BeatSaverMark, url: 'https://beatsaver.com/?q=%s' },
]

/** "Artist - Title", or whichever of the two the song has. */
export function trackSearchText(track) {
  return [track?.artist, track?.title].map(value => String(value || '').trim()).filter(Boolean).join(' - ')
}

export function trackSearchUrl(site, track) {
  return site.url.replace('%s', encodeURIComponent(trackSearchText(track)))
}

/** The song's comment when it's a web link (and nothing else), else null. */
export function commentLink(track) {
  const text = String(track?.comment || '').trim()
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null
}

/** Where the video set for the song in its Edit Track window opens (a link, or a file's file:// address), else null. */
export function clipLink(track) {
  return clipOpenUrl(track?.clip_url)
}

/** That video as it was entered (the song list's column shows it). */
export function clipText(track) {
  const text = String(track?.clip_url || '').trim()
  return clipOpenUrl(text) ? text : null
}

export function openLink(url) {
  return api.openExternal(url)
}
