// "Search on YouTube / Genius / BeatSaver", "Open comment" and "Open music
// video" in a song's right-click menu: the searches look for "Artist - Title"
// (from its tags) on the site, in the system's default browser.

import { api } from './api'

export const TRACK_SEARCH_SITES = [
  { key: 'youtube', label: 'Search on YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { key: 'genius', label: 'Search on Genius', url: 'https://genius.com/search?q=%s' },
  { key: 'beatsaver', label: 'Search on BeatSaver', url: 'https://beatsaver.com/?q=%s' },
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

/** The music video link set for the song in its Edit Track window, else null. */
export function clipLink(track) {
  const text = String(track?.clip_url || '').trim()
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : null
}

export function openLink(url) {
  return api.openExternal(url)
}
