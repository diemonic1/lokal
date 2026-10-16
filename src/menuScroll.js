// Menus and dropdowns close when the page scrolls under them -- but not when
// a list moves on its own (the lyrics following the song): that used to shut
// every open menu on each new line.

const autoScrolled = new WeakMap()
const AUTO_SCROLL_MS = 250

/** Call right before moving an element's scroll position from code. */
export function markAutoScroll(element) {
  if (element) autoScrolled.set(element, performance.now())
}

/**
 * Whether a scroll event should close a menu. `inside`: the menu's own
 * elements (scrolling inside them never closes it).
 */
export function scrollClosesMenu(event, inside = []) {
  const target = event?.target
  if (inside.some(node => node && target instanceof Node && node.contains(target))) return false
  const at = autoScrolled.get(target)
  return !(at != null && performance.now() - at < AUTO_SCROLL_MS)
}
