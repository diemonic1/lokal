// The header's quick settings (next to Downloads): a popup to switch the
// visualizations (side panel with lyrics, side panel fullscreen, player bar)
// without going to Settings, and the Full App Export from Settings > Backup.
// A switch shows at once (previewAppearanceValue) and saves; an open Settings
// page hears of it (QUICK_SETTING_EVENT) and shows it too.

import React, { useState } from 'react'
import { Check, Download } from 'lucide-react'
import { api } from '../api'
import { previewAppearanceValue, usePlayerVisualizer, useSideVisual } from '../appearanceFlags'
import { exportAllAppData } from '../appBackup'
import { useTranslation } from '../i18n'
import HeaderPopover, { createPopoverStore } from './HeaderPopover'

export const QUICK_SETTING_EVENT = 'lokal:quick-setting'

const useQuickSettingsPopup = createPopoverStore()

const SIDE_KINDS = [['off', 'Off'], ['character', 'Round character'], ['anomaly', 'Anomaly'], ['splashes', 'Colour splashes']]
const PLAYER_KINDS = [['off', 'Off'], ['waveform', 'Beside the volume'], ['spectrum', 'Spectrum'], ['spectrumCenter', 'Spectrum from the center'], ['waves', 'Waves'], ['lightning', 'Lightning']]

// Three horizontal sliders with filled knobs at different places.
function QuickSettingsIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M3 5h18M3 12h18M3 19h18" />
      <circle cx="15" cy="5" r="3" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12" r="3" fill="currentColor" stroke="none" />
      <circle cx="15" cy="19" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

function saveSetting(key, value) {
  previewAppearanceValue(key, value)
  window.dispatchEvent(new CustomEvent(QUICK_SETTING_EVENT, { detail: { key, value } }))
  Promise.resolve(api.saveSettings({ [key]: value }))
    .then(r => { if (!r?.error) window.dispatchEvent(new Event('lokal:settings-saved')) })
    .catch(() => {})
}

const OPENER = '[data-quick-settings-toggle]'

export function QuickSettingsButton() {
  const open = useQuickSettingsPopup(s => s.open)
  const toggle = useQuickSettingsPopup(s => s.toggle)
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-quick-settings-toggle
      onClick={toggle}
      title={t('Quick settings')}
      aria-label={t('Quick settings')}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center transition-colors ${open ? 'text-accent' : 'text-text/90 hover:text-text'}`}
    >
      <QuickSettingsIcon />
    </button>
  )
}

function VisualRow({ label, settingKey, value, options }) {
  const { t } = useTranslation()
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="min-w-0 text-[13px] text-white">{t(label)}</span>
      <select
        value={value}
        onChange={e => saveSetting(settingKey, e.target.value)}
        className="w-48 flex-shrink-0 bg-card border border-border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-accent/50"
      >
        {options.map(([option, name]) => <option key={option} value={option}>{t(name)}</option>)}
      </select>
    </label>
  )
}

export function QuickSettingsPanel() {
  const open = useQuickSettingsPopup(s => s.open)
  const close = useQuickSettingsPopup(s => s.close)
  const { t } = useTranslation()
  const textKind = useSideVisual('side_visual_text', 'character')
  const fullKind = useSideVisual('side_visual_full', 'splashes')
  const playerKind = usePlayerVisualizer()
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState(false)

  const exportAll = async () => {
    setExporting(true)
    try {
      await exportAllAppData()
      setExported(true)
      setTimeout(() => setExported(false), 3000)
    } catch (e) {
      alert(t('Failed to export app data: {error}', { error: e.message }))
    } finally {
      setExporting(false)
    }
  }

  return (
    <HeaderPopover open={open} onClose={close} opener={OPENER} width={420} label={t('Quick settings')}>
      <div className="space-y-4">
        <section className="space-y-3">
          <p className="text-[10px] font-display uppercase tracking-[0.2em] text-subtle">{t('Visualizations')}</p>
          <VisualRow label="Visualization with lyrics" settingKey="side_visual_text" value={textKind} options={SIDE_KINDS} />
          <VisualRow label="Fullscreen visualization" settingKey="side_visual_full" value={fullKind} options={SIDE_KINDS} />
          <VisualRow label="Player bar visualization" settingKey="player_visualizer" value={playerKind} options={PLAYER_KINDS} />
        </section>
        <div className="border-t border-border" />
        <section className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] text-white">{t('Full App Export')}</p>
            <p className="mt-0.5 text-[11px] text-muted">{t("Save everything (accounts, settings, themes, playlists, likes, history) to one file. Your music files aren't included.")}</p>
          </div>
          <button
            onClick={exportAll}
            disabled={exporting}
            className="flex flex-shrink-0 items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-display uppercase tracking-wider border border-border text-muted hover:text-white transition-colors disabled:opacity-50"
          >
            {exported ? <Check size={13} className="text-accent" /> : <Download size={13} />} {t(exporting ? 'Exporting...' : 'Export All')}
          </button>
        </section>
      </div>
    </HeaderPopover>
  )
}
