// Widths are in rem, including gaps, so larger text uses the compact layout
// sooner. Header and rows use the exact same template, never content-sized cells.
export const TRACK_COLUMN_OPTIONS = [
  ['number', 'Track number'],
  ['artwork', 'Artwork'],
  ['artist', 'Artist'],
  ['source', 'Source'],
  ['quality', 'Quality'],
  ['genre', 'Genre'],
  ['comment', 'Comment'],
  ['added', 'Date added'],
  ['time', 'Duration'],
  ['actions', 'Quick actions'],
  ['grip', 'Drag handle'],
]

// Columns that sit side by side in the grid, in their default order. The
// picker reorders these; Artwork and Artist live inside Title, Quick actions
// and the drag handle stay at the row's ends.
// A flex column takes a share of the room left (its width is a weight, so it
// keeps its proportion as the window changes); a fixed one is a width in rem.
export const TRACK_COLUMN_DEFS = {
  number: { label: 'Track number', fixed: 2, min: 1.5 },
  title: { label: 'Title', flex: 3, min: 11 },
  album: { label: 'Album', flex: 2, min: 8 },
  source: { label: 'Source', fixed: 2, min: 1.5 },
  quality: { label: 'Quality', fixed: 4.5, min: 3.5 },
  genre: { label: 'Genre', flex: 1.2, min: 5 },
  comment: { label: 'Comment', flex: 1.5, min: 6 },
  added: { label: 'Date added', fixed: 5.5, min: 4 },
  time: { label: 'Duration', fixed: 3, min: 2.5 },
}
export const DEFAULT_COLUMN_ORDER = ['number', 'title', 'album', 'source', 'quality', 'genre', 'comment', 'added', 'time']
export const ALWAYS_SHOWN = new Set(['title', 'album'])
export const MAX_FIXED_WIDTH = 30

export const ROW_SIZE = { min: 0.75, max: 1.5, step: 0.05, initial: 1 }

export function trackColumnDefaults(showQuality = false, playlist = false) {
  return { number: true, artwork: true, artist: true, source: true, quality: showQuality, genre: false, comment: false, added: playlist, time: true, actions: true, grip: true }
}

export function trackColumnPreferences(saved, showQuality = false, playlist = false) {
  const result = trackColumnDefaults(showQuality, playlist)
  for (const [key] of TRACK_COLUMN_OPTIONS) {
    if (typeof saved?.[key] === 'boolean') result[key] = saved[key]
  }
  result.order = columnOrder(saved?.order)
  result.widths = saved?.widths && typeof saved.widths === 'object' ? saved.widths : {}
  const size = Number(saved?.rowSize)
  result.rowSize = Number.isFinite(size) ? Math.min(ROW_SIZE.max, Math.max(ROW_SIZE.min, size)) : ROW_SIZE.initial
  return result
}

// The saved order, minus unknown keys, with any newer column slotted in at
// its default place.
export function columnOrder(saved) {
  const order = Array.isArray(saved) ? saved.filter(key => key in TRACK_COLUMN_DEFS) : []
  DEFAULT_COLUMN_ORDER.forEach((key, index) => {
    if (order.includes(key)) return
    const before = DEFAULT_COLUMN_ORDER.slice(0, index).reverse().find(k => order.includes(k))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, key)
  })
  return [...new Set(order)]
}

/** The column's width: rem for a fixed one, a weight for a flex one. */
export function columnWidth(key, widths, extra = null) {
  const def = TRACK_COLUMN_DEFS[key]
  const saved = Number(widths?.[key])
  if (def?.flex) return saved > 0 ? saved : def.flex
  const base = extra ? (extra.width || 5.5) : def.fixed
  return saved > 0 ? Math.min(MAX_FIXED_WIDTH, Math.max(def?.min || 2, saved)) : base
}

export function trackColumnLayout(width, columns, { playlist = false, actionSlots = 0, likedTrack = false, extraColumns = [] } = {}) {
  const visible = { title: true }
  const widths = columns.widths || {}
  const extraByKey = Object.fromEntries(extraColumns.map(column => [column.key, column]))
  const fixedWidth = key => columnWidth(key, widths, extraByKey[key])
  // Padding, a readable Title, and the always-reachable More menu.
  let remaining = width - 1.25 - TRACK_COLUMN_DEFS.title.min - 1.25 - 0.5 - (likedTrack ? 1.25 : 0)
  const fit = (key, size, enabled = true) => {
    visible[key] = enabled && remaining >= size + 0.5
    if (visible[key]) remaining -= size + 0.5
  }
  // Keep quality and the tiny source mark before less essential metadata.
  fit('quality', fixedWidth('quality'), columns.quality)
  fit('source', fixedWidth('source'), columns.source)
  for (const column of extraColumns) fit(column.key, fixedWidth(column.key))
  fit('album', TRACK_COLUMN_DEFS.album.min)
  fit('time', fixedWidth('time'), columns.time)
  fit('number', fixedWidth('number'), columns.number)
  fit('genre', TRACK_COLUMN_DEFS.genre.min, columns.genre)
  fit('comment', TRACK_COLUMN_DEFS.comment.min, columns.comment)
  fit('added', fixedWidth('added'), columns.added)
  fit('grip', 1, playlist && columns.grip)
  const extraActions = actionSlots * 1.25 + 1.5
  fit('actions', extraActions, columns.actions)
  // The More button is always present. A liked track also needs room for its
  // persistent heart even when optional quick actions are hidden.
  const actionsWidth = (visible.actions ? extraActions + 1.25 : 1.25) + (likedTrack ? 1.25 : 0)

  // A page's own columns sit just before Date added unless moved.
  const order = [...(columns.order || DEFAULT_COLUMN_ORDER)]
  for (const column of extraColumns) {
    if (order.includes(column.key)) continue
    const at = order.indexOf('added')
    order.splice(at < 0 ? order.length : at, 0, column.key)
  }
  const shown = order.filter(key => visible[key])
  const track = key => {
    const def = TRACK_COLUMN_DEFS[key]
    return def?.flex ? `minmax(0,${columnWidth(key, widths)}fr)` : `${fixedWidth(key)}rem`
  }
  const template = [
    visible.grip && '1rem',
    ...shown.map(track),
    `${actionsWidth}rem`,
  ].filter(Boolean).join(' ')
  return { ...visible, likedTrack, order: shown, template }
}
