// Settings > Playback > Sync Offset: how much later (or earlier) lyrics,
// music videos and visualizations are shown than the sound, for each output
// Lokal has seen (see ../syncOffset.js). Bluetooth plays late, so it usually
// wants a little plus.

import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Bluetooth, Headphones, Minus, Plus, RotateCcw, Speaker } from 'lucide-react'
import { useSyncOffsets } from '../syncOffset'
import { SYNC_OFFSET_MAX, SYNC_OFFSET_STEP, clampSyncOffset, deviceKind } from '../syncOffsetCore'
import { useTranslation } from '../i18n'

const KIND_LABEL = { bluetooth: 'Bluetooth', headphones: 'Headphones', speaker: 'Speakers' }

function KindIcon({ kind, size = 14 }) {
  if (kind === 'bluetooth') return <Bluetooth size={size} aria-hidden="true" />
  if (kind === 'headphones') return <Headphones size={size} aria-hidden="true" />
  return <Speaker size={size} aria-hidden="true" />
}

/** 0.25 -> "+0.25", -0.3 -> "−0.30" */
const signed = value => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}`
const parseOffset = raw => {
  const text = String(raw).trim().replace('−', '-').replace(',', '.')
  const n = Number(text)
  return text !== '' && text !== '-' && text !== '+' && Number.isFinite(n) ? n : null
}

// The offset as a field to type into: shown signed ("+0.25"); a number in
// range applies as it's typed, leaving the field puts it within ±3.
function OffsetField({ value, onChange, label }) {
  const { t } = useTranslation()
  const [text, setText] = useState(signed(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(signed(value)) }, [value, editing])
  const finish = () => {
    setEditing(false)
    const n = parseOffset(text)
    if (n == null) { setText(signed(value)); return }
    const clamped = clampSyncOffset(n)
    if (clamped !== value) onChange(clamped)
    setText(signed(clamped))
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted">
      <input type="text" inputMode="decimal" value={text} aria-label={label} spellCheck={false}
        onFocus={e => { setEditing(true); e.currentTarget.select() }}
        onChange={e => {
          setText(e.target.value)
          const n = parseOffset(e.target.value)
          if (n != null && Math.abs(n) <= SYNC_OFFSET_MAX) onChange(clampSyncOffset(n))
        }}
        onBlur={finish}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setText(signed(value)); setEditing(false); e.currentTarget.blur() }
        }}
        className="w-16 rounded-md border border-border bg-card px-1.5 py-1 text-right text-sm tabular-nums text-text outline-none focus:border-accent/50" />
      <span>{t('{n} s', { n: '' }).trim()}</span>
    </span>
  )
}

export default function SyncOffsetSettings() {
  const { t } = useTranslation()
  const devices = useSyncOffsets(state => state.devices)
  const activeKey = useSyncOffsets(state => state.activeKey)
  const setOffset = useSyncOffsets(state => state.setOffset)
  const [picked, setPicked] = useState(null)

  // The one playing now first, then the most recently seen.
  const list = useMemo(() => Object.entries(devices)
    .map(([key, device]) => ({ key, ...device, kind: deviceKind(device.name) }))
    .sort((a, b) => (b.key === activeKey) - (a.key === activeKey) || (b.seenAt || 0) - (a.seenAt || 0) || a.name.localeCompare(b.name)),
  [devices, activeKey])
  const key = picked && devices[picked] ? picked : devices[activeKey] ? activeKey : list[0]?.key
  const device = list.find(item => item.key === key)

  if (!device) return <p className="text-xs text-muted leading-relaxed">{t('No audio devices yet. Start playing a song and the device it plays on shows up here.')}</p>

  const offset = device.offset || 0
  const change = value => setOffset(device.key, value)
  const nudge = step => change(clampSyncOffset(offset + step))
  const playing = device.key === activeKey
  const status = offset > 0 ? t('Lyrics, video and visualizations are shown {n} s later than the sound.', { n: Math.abs(offset).toFixed(2) })
    : offset < 0 ? t('Lyrics and video are shown {n} s earlier than the sound.', { n: Math.abs(offset).toFixed(2) })
      : t('No shift: shown in step with the sound.')

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted leading-relaxed">{t('Bluetooth headphones and speakers play the sound a little late, so lyrics, music videos and visualizations run ahead of what you hear. Set a shift for each device: Lokal remembers every device it has played on. The sound itself is never moved.')}</p>

      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white font-medium">{t('Device')}</p>
          <p className="text-xs text-muted mt-0.5 leading-relaxed">{playing ? t('Playing on this device now.') : t('Not playing on this device now: its shift applies when it is.')}</p>
        </div>
        <label className="flex min-w-0 max-w-72 items-center gap-2 text-muted">
          <KindIcon kind={device.kind} />
          <select value={device.key} onChange={e => setPicked(e.target.value)} aria-label={t('Device')}
            className="min-w-0 max-w-64 truncate bg-card border border-border rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-accent/50">
            {list.map(item => (
              <option key={item.key} value={item.key}>
                {item.key === activeKey ? t('{name} · playing now', { name: item.name }) : item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-white font-medium flex items-center gap-1.5">
              {t('Offset for this device')}
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">{t(KIND_LABEL[device.kind])}</span>
            </p>
            <p className="text-xs text-muted mt-0.5" aria-live="polite">{status}</p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => nudge(-SYNC_OFFSET_STEP)} aria-label={t('Earlier by 0.01 s')} title={t('Earlier by 0.01 s')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:text-white"><Minus size={13} /></button>
            <OffsetField value={offset} onChange={change} label={t('Offset for {name}', { name: device.name })} />
            <button type="button" onClick={() => nudge(SYNC_OFFSET_STEP)} aria-label={t('Later by 0.01 s')} title={t('Later by 0.01 s')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:text-white"><Plus size={13} /></button>
            <button type="button" onClick={() => change(0)} disabled={!offset} aria-label={t('Reset')} title={t('Reset')}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted hover:text-white disabled:opacity-30"><RotateCcw size={13} /></button>
          </div>
        </div>

        <div>
          <div className="relative">
            <input type="range" min={-SYNC_OFFSET_MAX} max={SYNC_OFFSET_MAX} step={SYNC_OFFSET_STEP} value={offset}
              onChange={e => change(e.target.value)} aria-label={t('Offset for {name}', { name: device.name })}
              aria-valuetext={t('{n} s', { n: signed(offset) })} className="w-full accent-accent" />
            <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-full h-1.5 w-px -translate-x-1/2 bg-muted/60" />
          </div>
          <div className="mt-1.5 grid grid-cols-3 text-[11px] text-muted">
            <span className="flex items-center gap-1"><ArrowLeft size={11} aria-hidden="true" />{t('Lyrics and video earlier')} · {t('{n} s', { n: '−3' })}</span>
            <span className="text-center">0</span>
            <span className="flex items-center justify-end gap-1">{t('{n} s', { n: '+3' })} · {t('Lyrics and video later')}<ArrowRight size={11} aria-hidden="true" /></span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-3 space-y-2 text-xs leading-relaxed">
        <p className="flex gap-2 text-text">
          <ArrowRight size={14} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
          <span>{t('The sound lags behind the lyrics and video (usual with Bluetooth): move right, to +. Bluetooth devices usually need +0.10 to +0.30 s.')}</span>
        </p>
        <p className="flex gap-2 text-text">
          <ArrowLeft size={14} className="mt-0.5 flex-shrink-0 text-accent" aria-hidden="true" />
          <span>{t('The lyrics and video lag behind the sound: move left, to −.')}</span>
        </p>
        <p className="text-muted">{t('How to set it: play a song with synced lyrics and move the slider until the highlighted words land on the singing.')}</p>
        {offset < 0 && <p className="text-muted">{t('Visualizations can only wait for the sound: below 0 they stay as they are.')}</p>}
      </div>
    </div>
  )
}
