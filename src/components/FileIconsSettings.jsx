// Settings > File Icons: which icons audio files get in Explorer once they
// open with Lokal -- Lokal's own set or an AIMP icon pack from the "icons"
// folder -- and covers in their place where the file has one
// (electron/ipc/fileIcons.js, electron/iconPacks.js).
//
// The controls stay in a column on the left, in view however far the list
// of sets on the right is scrolled.

import React, { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, FolderOpen, Info, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { api } from '../api'
import { useTranslation } from '../i18n'

const CATALOG_URL = 'https://aimp.ru/?do=catalog&os=desktop&id=1&sort=1'
const INSTRUCTIONS = [
  'Download an icon pack from the AIMP catalog (Download more icons): it comes as a .zip.',
  'Take the .dll out of the .zip: Lokal reads the .dll itself, not the .zip.',
  'Put the .dll into the "icons" folder next to Lokal Player.exe (Open the icons folder).',
  'Press Refresh and pick the pack here, then Apply.',
  'Once: right-click an audio file > Open with > Choose another app > Lokal, with "Always". Do it once for each type (MP3, FLAC...) that should get these icons.',
  'To change the icons later, pick another set and Apply: no need to choose Lokal again.',
  'Files with a cover show the cover (read by Windows itself: MP3, FLAC, WAV, M4A, OGG, Opus, WMA, APE and others); the rest show the set\'s icon. Only AIMP\'s file icon packs fit, not its skins or plugins.',
]

const button = 'flex w-full items-center gap-1.5 px-3 py-1.5 bg-card border border-border rounded-lg text-xs text-muted hover:text-white disabled:opacity-40'

export default function FileIconsSettings() {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [picked, setPicked] = useState(null)
  const [covers, setCovers] = useState(true)
  const [coverIcons, setCoverIcons] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  const load = useCallback(async () => {
    const next = await api.fileIcons()
    setData(next)
    if (next) {
      setPicked(current => (current && next.sets.some(set => set.id === current) ? current : (next.applied || next.sets[0]?.id)))
      setCovers(next.coversEverywhere)
      setCoverIcons(next.coverIcons)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const apply = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.applyFileIcons(picked, { coversEverywhere: covers, coverIcons: coverIcons && data?.coverIconsAvailable })
      const name = data?.sets.find(set => set.id === picked)?.name || picked
      setStatus(result?.ok ? { ok: true, text: t('Applied: {name} · {n} file types', { name, n: result.count }) } : { ok: false, text: result?.error || t('Something went wrong') })
      await load()
    } finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await api.removeFileIcons()
      setStatus(result?.ok ? { ok: true, text: t('Lokal\'s file types removed: Explorer shows the files as before.') } : { ok: false, text: result?.error || t('Something went wrong') })
      await load()
    } finally { setBusy(false) }
  }

  if (!data) return <div className="flex justify-center py-6 text-muted"><Loader2 size={16} className="animate-spin" /></div>

  const pickedSet = data.sets.find(set => set.id === picked)

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      {/* Left: the controls, held in view while the list scrolls. */}
      {/* Sticks just under Settings' own sticky bar (--settings-bar-height, set by Settings). */}
      <aside className="space-y-3 md:sticky md:top-[calc(var(--settings-bar-height,8rem)+1rem)] md:w-60 md:flex-shrink-0">
        <div className="flex gap-2">
          <button type="button" className={button} onClick={() => api.openExternal(CATALOG_URL)}>
            <ExternalLink size={13} /> {t('Download more icons')}
          </button>
          <div className="group/info relative flex-shrink-0">
            <button type="button" className="flex h-full items-center px-2 bg-card border border-border rounded-lg text-muted hover:text-white" aria-label={t('How to add icons')}>
              <Info size={14} />
            </button>
            <div role="tooltip"
              className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 w-[26rem] max-w-[80vw] rounded-xl border border-border bg-elevated p-3 text-xs leading-relaxed text-muted opacity-0 shadow-xl transition-opacity group-hover/info:visible group-hover/info:opacity-100 group-focus-within/info:visible group-focus-within/info:opacity-100">
              <p className="mb-1.5 font-medium text-white">{t('How to add icons')}</p>
              <ol className="list-decimal space-y-1 pl-4">
                {INSTRUCTIONS.map(line => <li key={line}>{t(line)}</li>)}
              </ol>
              <p className="mt-2 break-all text-[11px] text-subtle">{data.folder}</p>
            </div>
          </div>
        </div>
        <button type="button" className={button} onClick={() => api.openFileIconsFolder()}>
          <FolderOpen size={13} /> {t('Open the icons folder')}
        </button>
        <button type="button" className={button} onClick={load} disabled={busy}>
          <RefreshCw size={13} /> {t('Refresh')}
        </button>

        <div className="space-y-3 border-t border-border pt-3">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" className="mt-0.5" checked={covers} onChange={e => setCovers(e.target.checked)} />
            <span>
              <span className="block text-sm text-white">{t('Covers in every icon size')}</span>
              <span className="block text-[11px] leading-snug text-muted">{t('Covers from Small icons up. Off: from Medium icons up, as Windows does by itself.')}</span>
            </span>
          </label>
          {/* Details and List draw icons, never thumbnails: there the cover is the icon (native/icon-handler). */}
          <label className={`flex items-start gap-2.5 ${data.coverIconsAvailable ? 'cursor-pointer' : 'opacity-50'}`}>
            <input type="checkbox" className="mt-0.5" checked={coverIcons && data.coverIconsAvailable} disabled={!data.coverIconsAvailable} onChange={e => setCoverIcons(e.target.checked)} />
            <span>
              <span className="block text-sm text-white">{t('Covers in Details and List')}</span>
              <span className="block text-[11px] leading-snug text-muted">{data.coverIconsAvailable
                ? t("A small Lokal module inside Explorer gives each file its cover as its icon; files without one show the set's icon. Explorer may show a change only after it restarts.")
                : t('Not in this build: it was made without the C++ build tools.')}</span>
            </span>
          </label>
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          {pickedSet && <p className="truncate text-xs text-muted">{t('Picked: {name}', { name: pickedSet.builtin ? t('Lokal (built-in)') : pickedSet.name })}</p>}
          <button type="button" onClick={apply} disabled={busy || !picked || !data.canRegister}
            className="flex w-full items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-display uppercase tracking-wider border bg-accent/20 border-accent/50 text-accent disabled:opacity-40">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t('Apply')}
          </button>
          <button type="button" className={button} onClick={remove} disabled={busy || !data.applied}>
            <Trash2 size={13} /> {t('Remove the icons and file types')}
          </button>
          {!data.canRegister && <p className="text-[11px] text-muted">{t('Only the built app can register file types.')}</p>}
          {status && <p className={`text-xs ${status.ok ? 'text-muted' : 'text-red-400'}`}>{status.text}</p>}
        </div>
      </aside>

      {/* Right: the sets. */}
      <div className="min-w-0 flex-1 space-y-2" role="radiogroup" aria-label={t('File icons')}>
        {data.sets.map(set => {
          const selected = picked === set.id
          const applied = data.applied === set.id
          return (
            <button key={set.id} type="button" role="radio" aria-checked={selected} onClick={() => setPicked(set.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent/60 bg-accent/10' : 'border-border bg-card hover:border-accent/30'}`}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white">{set.builtin ? t('Lokal (built-in)') : set.name}</span>
                {set.author && <span className="text-xs text-muted">{set.author}</span>}
                {set.file && <span className="truncate text-[11px] text-subtle">{set.file}</span>}
                {applied && <span className="ml-auto flex flex-shrink-0 items-center gap-1 text-[11px] text-accent"><Check size={12} /> {t('Applied')}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {set.preview.map(item => (
                  <figure key={item.ext} className="flex w-12 flex-col items-center gap-0.5">
                    {item.src ? <img src={item.src} alt="" className="h-9 w-9 object-contain" draggable={false} /> : <div className="h-9 w-9 rounded bg-white/5" />}
                    <figcaption className="text-[10px] text-muted">{item.label === 'other' ? t('Other') : item.label}</figcaption>
                  </figure>
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
