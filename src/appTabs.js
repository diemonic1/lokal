// The order of the tabs under the title bar and which of them sit in the ⋯
// menu after the last one (Settings > Appearance > App Tabs). Saved as the
// `app_tabs` setting: the tab paths in order, with HIDDEN_MARK where the
// hidden ones start.

import { TABS } from './libraryNav'
import { useAppearanceText } from './appearanceFlags'

export const HIDDEN_MARK = '|'
export const DEFAULT_TAB_ORDER = ['/', '/library', '/albums', '/artists', '/genres', '/stations', '/videos', HIDDEN_MARK, '/recap', '/quality', '/lyrics-analysis']

/** The saved order, minus unknown tabs, with any newer tab in its default place. */
export function tabOrder(saved) {
  let list = []
  try { list = typeof saved === 'string' && saved ? JSON.parse(saved) : Array.isArray(saved) ? saved : [] } catch {}
  if (!Array.isArray(list)) list = []
  const known = new Set(TABS.map(tab => tab.path))
  const order = [...new Set(list.filter(path => path === HIDDEN_MARK || known.has(path)))]
  if (!order.includes(HIDDEN_MARK)) order.push(HIDDEN_MARK)
  // A newer tab goes just before the tab that follows it by default (Online
  // Radio before Videos), or else just after the one before it.
  DEFAULT_TAB_ORDER.forEach((path, index) => {
    if (order.includes(path)) return
    const next = DEFAULT_TAB_ORDER.slice(index + 1).find(p => p !== HIDDEN_MARK && order.includes(p))
    if (next) { order.splice(order.indexOf(next), 0, path); return }
    const before = DEFAULT_TAB_ORDER.slice(0, index).reverse().find(p => order.includes(p))
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, path)
  })
  return order
}

/** { visible, hidden }: the tabs (from TABS) in the user's order. */
export function splitTabs(order) {
  const byPath = Object.fromEntries(TABS.map(tab => [tab.path, tab]))
  const at = order.indexOf(HIDDEN_MARK)
  return {
    visible: order.slice(0, at).map(path => byPath[path]).filter(Boolean),
    hidden: order.slice(at + 1).map(path => byPath[path]).filter(Boolean),
  }
}

export function useAppTabs() {
  return splitTabs(tabOrder(useAppearanceText('app_tabs', '')))
}
