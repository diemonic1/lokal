// Playing and downloading the songs of the online album and artist pages
// (see onlineBrowse.js), with progress in a toast.

import { api } from './api.js'
import { libraryDownloadMessage, saveTracksToLibrary } from './onlineTracks.js'
import { playRecommendationPool } from './recommendationPlayback.js'
import { playbackFallbackMessage, resolveRecommendationTracks } from './recommendations.js'
import { showLoadingToast, showToast } from './components/Toaster.jsx'
import { translate } from './i18n'

/** Play `tracks` from `selected` (or the first), finding each in the playback sources. */
export async function playOnline(tracks, { selected, name, path, isCurrent = () => true } = {}) {
  const first = selected || tracks[0]
  if (!first) return false
  const toast = showLoadingToast(translate('Finding “{title}”…', { title: first.title }))
  let detail = ''
  try {
    const started = await playRecommendationPool(tracks, {
      selected, firstPlayable: true, isCurrent,
      context: { type: 'discovery', name, path },
      onProgress: message => { if (isCurrent()) toast.update(message) },
      onProviderFailure: failure => { if (isCurrent()) { if (failure.detail) detail = failure.detail; toast.update(playbackFallbackMessage(failure)) } },
    })
    toast.close(isCurrent() && started === false ? detail ? translate('Could not play “{title}”. {detail}', { title: first.title, detail }) : translate('No playable source was found for “{title}”.', { title: first.title }) : '')
    return started
  } catch {
    toast.close(isCurrent() ? translate('Could not load “{title}”.', { title: first.title }) : '')
    return false
  }
}

/** Find `tracks` in the playback sources (without preparing streams). */
export async function resolveOnline(tracks, { label, isCurrent = () => true } = {}) {
  const toast = showLoadingToast(label ? translate('Finding {label}…', { label }) : tracks.length === 1 ? translate('Finding “{title}”…', { title: tracks[0].title }) : translate('Finding {n} song…|Finding {n} songs…', { n: tracks.length }))
  try {
    const rows = await resolveRecommendationTracks(tracks, api, { isCurrent, prepareStreams: false, onProgress: message => { if (isCurrent()) toast.update(message) } })
    toast.close(!rows.length && isCurrent() ? (label ? translate('No playable source was found for {label}.', { label }) : translate('No playable source was found for these songs.')) : '')
    return isCurrent() ? rows : []
  } catch {
    toast.close(isCurrent() ? (label ? translate('Could not load {label}.', { label }) : translate('Could not load these songs.')) : '')
    return []
  }
}

/** Download `tracks` to the library, from the best playback source for each. */
export async function downloadOnline(tracks, { label, isCurrent = () => true } = {}) {
  const rows = await resolveOnline(tracks, { label, isCurrent })
  if (!rows.length) return
  const result = await saveTracksToLibrary(rows, { isCurrent })
  result.failed += tracks.length - rows.length
  showToast(libraryDownloadMessage(result))
}
