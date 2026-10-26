import React, { useState } from 'react'
import { ChevronDown, ChevronUp, CornerLeftUp, CornerRightDown, GripVertical, RotateCcw } from 'lucide-react'
import { DEFAULT_HEADER_LAYOUT, HEADER_ITEM, MORE, SEP_LEFT, SEP_RIGHT, groupable, headerLayout } from '../headerLayout'
import { useTranslation } from '../i18n'

/**
 * Settings > App Top Bars > Top Bar Buttons: drag the header's buttons (or
 * use the arrows) to reorder them. The two lines split the header into its
 * left part, middle and right part; the search box moves like a button. The
 * ⋯ row is the More button, with its group under it: drag a button into the
 * group (or use the arrow into ⋯) to keep it in the ⋯ menu instead of the bar.
 * `value` is the saved `header_layout` setting; onChange gets the new one.
 */
export default function HeaderLayoutSettings({ value, onChange }) {
  const { t } = useTranslation()
  const layout = headerLayout(value)
  // What's being dragged and where it would go: { list: 'order' | 'more', index }.
  const [dragged, setDragged] = useState(null)
  const [over, setOver] = useState(null)

  const save = next => onChange(JSON.stringify(headerLayout(next)))
  const lists = () => ({ order: [...layout.order], more: [...layout.more] })
  /** Moves the item at `from` to `to` (index in its list; past the end appends). */
  const move = (from, to) => {
    const next = lists()
    const id = next[from.list][from.index]
    if (id == null) return
    if (to.list === 'more' && !groupable(id)) return
    next[from.list].splice(from.index, 1)
    let index = to.index
    if (from.list === to.list && from.index < to.index) index--
    next[to.list].splice(Math.max(0, Math.min(index, next[to.list].length)), 0, id)
    save(next)
  }
  const step = (list, index, by) => {
    const target = index + by
    if (target < 0 || target >= layout[list].length) return
    const next = lists()
    ;[next[list][index], next[list][target]] = [next[list][target], next[list][index]]
    save(next)
  }
  // Out of the group: right after the ⋯ button, where it was hidden.
  const ungroup = index => {
    const next = lists()
    const [id] = next.more.splice(index, 1)
    next.order.splice(next.order.indexOf(MORE) + 1, 0, id)
    save(next)
  }
  const group = index => {
    const next = lists()
    const [id] = next.order.splice(index, 1)
    next.more.push(id)
    save(next)
  }
  const endDrag = () => { setDragged(null); setOver(null) }
  const dropTarget = (list, index) => ({
    onDragOver: event => {
      if (!dragged) return
      if (list === 'more' && !groupable(layout[dragged.list][dragged.index])) return
      event.preventDefault()
      event.stopPropagation()
      setOver({ list, index })
    },
    onDrop: event => {
      event.preventDefault()
      event.stopPropagation()
      if (dragged) move(dragged, { list, index })
      endDrag()
    },
  })
  const isOver = (list, index) => over?.list === list && over.index === index && !(dragged?.list === list && dragged.index === index)
  const dragSource = (list, index, id) => ({
    draggable: true,
    onDragStart: event => { event.stopPropagation(); setDragged({ list, index }); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id) },
  })

  const arrow = 'rounded p-0.5 text-muted hover:text-white disabled:opacity-30'
  const arrows = (list, index) => <>
    <button type="button" onClick={() => step(list, index, -1)} disabled={index === 0} title={t('Move up')} aria-label={t('Move up')} className={arrow}>
      <ChevronUp size={14} />
    </button>
    <button type="button" onClick={() => step(list, index, 1)} disabled={index === layout[list].length - 1} title={t('Move down')} aria-label={t('Move down')} className={arrow}>
      <ChevronDown size={14} />
    </button>
  </>

  const row = (list, index, id) => {
    const item = HEADER_ITEM[id]
    const Icon = item.icon
    return (
      <div key={id} {...dragSource(list, index, id)} {...dropTarget(list, index)}
        className={`flex items-center gap-2.5 rounded-lg border bg-card px-2 py-1.5 text-sm text-white transition-colors ${isOver(list, index) ? 'border-accent/60' : 'border-border'} ${dragged?.list === list && dragged.index === index ? 'opacity-50' : ''}`}>
        <GripVertical size={14} className="flex-shrink-0 cursor-grab text-muted active:cursor-grabbing" />
        <Icon size={14} className="flex-shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
        {list === 'order' && groupable(id) && (
          <button type="button" onClick={() => group(index)} title={t('Hide in the ⋯ menu')} aria-label={t('Hide in the ⋯ menu')} className={arrow}>
            <CornerRightDown size={14} />
          </button>
        )}
        {list === 'more' && (
          <button type="button" onClick={() => ungroup(index)} title={t('Take out of the ⋯ menu')} aria-label={t('Take out of the ⋯ menu')} className={arrow}>
            <CornerLeftUp size={14} />
          </button>
        )}
        {arrows(list, index)}
      </div>
    )
  }

  const separator = (index, id) => (
    <div key={id} {...dragSource('order', index, id)} {...dropTarget('order', index)}
      className={`flex cursor-grab items-center gap-2 py-1.5 active:cursor-grabbing ${dragged?.list === 'order' && dragged.index === index ? 'opacity-50' : ''}`}>
      <div className={`h-px flex-1 ${isOver('order', index) ? 'bg-accent' : 'bg-border'}`} />
      <span className="flex flex-shrink-0 items-center gap-1 text-[11px] uppercase tracking-wider text-muted">
        {id === SEP_LEFT ? t('Left part ↑ · Middle ↓') : t('Middle ↑ · Right part ↓')}
      </span>
      <div className={`h-px flex-1 ${isOver('order', index) ? 'bg-accent' : 'bg-border'}`} />
      {arrows('order', index)}
    </div>
  )

  return (
    <div className="space-y-1" onDragEnd={endDrag}>
      {layout.order.map((id, index) => {
        if (id === SEP_LEFT || id === SEP_RIGHT) return separator(index, id)
        if (id !== MORE) return row('order', index, id)
        return (
          <div key={id} className="space-y-1">
            {row('order', index, id)}
            {/* The ⋯ group: what its menu lists, top to bottom. */}
            <div {...dropTarget('more', layout.more.length)}
              className={`ml-6 space-y-1 rounded-lg border border-dashed p-1.5 ${over?.list === 'more' && over.index === layout.more.length ? 'border-accent/60' : 'border-border'}`}>
              {layout.more.map((child, childIndex) => row('more', childIndex, child))}
              <p className="px-1 py-0.5 text-[11px] text-muted">
                {layout.more.length ? t('Drag buttons here to hide them in the ⋯ menu.') : t('The ⋯ menu is empty, so its button is hidden. Drag buttons here to put them in it.')}
              </p>
            </div>
          </div>
        )
      })}
      <div className="pt-2">
        <button type="button" onClick={() => save(DEFAULT_HEADER_LAYOUT)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted hover:text-white">
          <RotateCcw size={12} /> {t('Reset to default')}
        </button>
      </div>
    </div>
  )
}
