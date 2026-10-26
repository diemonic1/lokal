// The window header's buttons (Settings > App Top Bars > Top Bar Buttons):
// their order, and which of them sit in the ⋯ group (the More button's menu,
// each shown there with its icon and name). Saved as the `header_layout`
// setting: { order: [...ids], more: [...ids] }.
//
// `order` runs left to right across the whole header. Two separators split it
// into the header's three parts: SEP_LEFT ends the left part (next to the app
// name), SEP_RIGHT starts the right part (before the window controls); the
// search box and the More button are items of it like any button. `more` is
// the ⋯ group's menu, top to bottom. The separators, the search box and the
// More button itself never go into the group.

import { Cast, Download, Home, Moon, MoreHorizontal, Radio, RefreshCw, Search, Settings, SquareArrowOutUpRight, Volume2 } from 'lucide-react'
import { useAppearanceText } from './appearanceFlags'
import { EqualizerIcon } from './components/EqualizerPopup'
import { QuickSettingsIcon } from './components/QuickSettings'

export const SEP_LEFT = '|left'
export const SEP_RIGHT = '|right'
export const SEARCH = 'search'
export const MORE = 'more'

// label: the button's tooltip, also its name in the ⋯ menu and in Settings.
export const HEADER_ITEMS = [
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'quickSettings', label: 'Quick settings', icon: QuickSettingsIcon },
  { id: 'rescan', label: 'Rescan all tracks', icon: RefreshCw },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'equalizer', label: 'Equalizer', icon: EqualizerIcon },
  { id: SEARCH, label: 'Search', icon: Search },
  { id: 'cast', label: 'Cast to a TV or speaker', icon: Cast },
  { id: 'audioOutput', label: 'Audio output', icon: Volume2 },
  { id: 'miniPlayer', label: 'Mini Player', icon: Radio },
  { id: 'sleepTimer', label: 'Sleep Timer', icon: Moon },
  { id: 'programs', label: 'Programs', icon: SquareArrowOutUpRight },
  { id: MORE, label: 'More', icon: MoreHorizontal },
]
export const HEADER_ITEM = Object.fromEntries(HEADER_ITEMS.map(item => [item.id, item]))

/** Can this item go into the ⋯ group? */
export const groupable = id => !!HEADER_ITEM[id] && id !== SEARCH && id !== MORE

export const DEFAULT_HEADER_LAYOUT = {
  order: ['settings', 'downloads', 'quickSettings', SEP_LEFT, 'rescan', 'home', 'equalizer', SEARCH, 'audioOutput', 'miniPlayer', MORE, SEP_RIGHT],
  more: ['programs', 'sleepTimer', 'cast'],
}
const DEFAULT_ORDER = DEFAULT_HEADER_LAYOUT.order

/**
 * The saved layout made whole: unknown ids dropped, each item once, both
 * separators in place (left before right), and any item it doesn't mention
 * (a newer button) where the default puts it.
 */
export function headerLayout(saved) {
  let value = null
  try { value = typeof saved === 'string' && saved ? JSON.parse(saved) : saved && typeof saved === 'object' ? saved : null } catch {}
  if (!value || !Array.isArray(value.order)) return { order: [...DEFAULT_ORDER], more: [...DEFAULT_HEADER_LAYOUT.more] }
  const seen = new Set()
  const keep = (id, test) => { if (!test(id) || seen.has(id)) return false; seen.add(id); return true }
  const order = value.order.filter(id => keep(id, x => x === SEP_LEFT || x === SEP_RIGHT || !!HEADER_ITEM[x]))
  const more = (Array.isArray(value.more) ? value.more : []).filter(id => keep(id, groupable))
  if (!order.includes(SEP_LEFT)) order.unshift(SEP_LEFT)
  if (!order.includes(SEP_RIGHT)) order.push(SEP_RIGHT)
  if (order.indexOf(SEP_LEFT) > order.indexOf(SEP_RIGHT)) {
    order.splice(order.indexOf(SEP_LEFT), 1)
    order.splice(order.indexOf(SEP_RIGHT), 0, SEP_LEFT)
  }
  for (const id of DEFAULT_HEADER_LAYOUT.more) if (!seen.has(id)) { seen.add(id); more.push(id) }
  DEFAULT_ORDER.forEach((id, index) => {
    if (seen.has(id) || order.includes(id)) return
    seen.add(id)
    // Just before the item that follows it by default, or after the one before it.
    const next = DEFAULT_ORDER.slice(index + 1).find(x => order.includes(x))
    if (next) { order.splice(order.indexOf(next), 0, id); return }
    const before = DEFAULT_ORDER.slice(0, index).reverse().find(x => order.includes(x))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id)
  })
  return { order, more }
}

/** { left, center, right, more }: the header's three parts and the ⋯ group, as ids. */
export function splitHeader(layout) {
  const { order, more } = layout
  const a = order.indexOf(SEP_LEFT)
  const b = order.indexOf(SEP_RIGHT)
  return { left: order.slice(0, a), center: order.slice(a + 1, b), right: order.slice(b + 1), more }
}

export function useHeaderLayout() {
  return splitHeader(headerLayout(useAppearanceText('header_layout', '')))
}
