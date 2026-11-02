// The side panel view a song opens on while it plays (Edit Track), kept in
// the library's tracks.side_panel_view only (see src/sidePanelViews.js).

const VIEWS = new Set(['info', 'lyrics', 'visual', 'visualLyrics', 'clip', 'clipLine'])

/** The column's value for an edit: a known view, else null (the one picked by hand). */
function sidePanelViewValue(value) {
  const view = String(value || '').trim()
  return VIEWS.has(view) ? view : null
}

module.exports = { sidePanelViewValue }
