// The side panel's views (its view picker), and the one a song can be set to
// open it on (Edit Track > Side panel view, kept in the library's
// tracks.side_panel_view, not in the file): while that song plays the panel
// shows its view, and goes back to the one picked by hand once another song
// (without one of its own) plays. Picking another view while it plays only
// lasts until the song changes.

export const SIDE_PANEL_VIEW_IDS = ['info', 'lyrics', 'visual', 'visualLyrics', 'clip', 'clipLine', 'queue']

/** The views a song can be set to (Queue isn't about the song), with their labels (to translate). */
export const TRACK_SIDE_PANEL_VIEWS = [
  { id: 'info', label: 'Details' },
  { id: 'lyrics', label: 'Lyrics' },
  { id: 'visual', label: 'Visualization' },
  { id: 'visualLyrics', label: 'Visualization + Lyrics' },
  { id: 'clip', label: 'Clip / Visualization' },
  { id: 'clipLine', label: 'Clip / Visualization + Line of Lyrics' },
]

const TRACK_VIEW_IDS = new Set(TRACK_SIDE_PANEL_VIEWS.map(view => view.id))

/** The view this song opens the side panel on, or null (the one picked by hand). */
export function trackSidePanelView(track) {
  const view = track?.side_panel_view
  return view && TRACK_VIEW_IDS.has(view) ? view : null
}
