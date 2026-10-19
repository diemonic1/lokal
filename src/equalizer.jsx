// The 10-band equalizer as the UI sees it: one store, so the Settings page and
// the header's equalizer popup show and change the same gains. Saved in
// localStorage ('lokal-eq'); the audio graph (App.jsx) reads it at start and
// takes each change through window.__lokaleq.

import React from 'react'
import { create } from 'zustand'
import { useTranslation } from './i18n'

export const EQ_BANDS = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz']
export const EQ_PRESETS = {
  flat: { label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  bassBoost: { label: 'Bass Boost', gains: [5, 4.5, 3, 1.5, 0.5, 0, -0.5, -1, -1.5, -2] },
  vocalBoost: { label: 'Vocal Boost', gains: [-1.5, -1, -0.5, 0.5, 1.5, 3, 3.5, 2.5, 1, 0] },
  bright: { label: 'Bright', gains: [-1, -0.5, 0, 0.5, 1, 1.5, 2.5, 3, 3.5, 3] },
  electronic: { label: 'Electronic', gains: [4, 3, 1, 0, -1, 1, 2, 3, 4, 4.5] },
  mellow: { label: 'Mellow', gains: [1.5, 1, 0.5, 0, -0.5, -1, -0.5, 0.5, 1, 1.5] },
}
export const DEFAULT_EQ_PRESET = 'flat'

export function normalizeEqGains(values) {
  const safeValues = Array.isArray(values) ? values.map(v => Number(v) || 0) : []
  if (safeValues.length === EQ_BANDS.length) {
    return safeValues.slice(0, EQ_BANDS.length)
  }
  if (safeValues.length === 5) {
    return [safeValues[0], safeValues[0], safeValues[1], safeValues[1], safeValues[2], safeValues[2], safeValues[3], safeValues[3], safeValues[4], safeValues[4]]
  }
  return EQ_BANDS.map((_, i) => safeValues[i] || 0)
}

export function getEqPresetKey(gains) {
  const normalized = normalizeEqGains(gains)
  const match = Object.entries(EQ_PRESETS).find(([, preset]) =>
    preset.gains.length === normalized.length && preset.gains.every((value, index) => value === normalized[index])
  )
  return match?.[0] || 'custom'
}

function readStoredGains() {
  try { return normalizeEqGains(JSON.parse(localStorage.getItem('lokal-eq') || '[]')) } catch { return EQ_PRESETS[DEFAULT_EQ_PRESET].gains }
}

const initialGains = readStoredGains()

export const useEqualizer = create((set, get) => ({
  gains: initialGains,
  preset: getEqPresetKey(initialGains),
  apply: (nextGains, presetKey = getEqPresetKey(nextGains)) => {
    const normalized = normalizeEqGains(nextGains)
    set({ gains: normalized, preset: presetKey })
    try {
      localStorage.setItem('lokal-eq', JSON.stringify(normalized))
      localStorage.setItem('lokal-eq-preset', presetKey)
    } catch {}
    window.__lokalInitAudio?.()
    normalized.forEach((gain, index) => {
      window.__lokaleq?.setGain(index, gain)
    })
  },
  setBand: (i, v) => {
    const next = [...get().gains]
    next[i] = v
    get().apply(next)
  },
}))

/** The equalizer itself: presets, a reset and the ten band sliders. */
export function EqualizerControls({ compact = false }) {
  const { t } = useTranslation()
  const gains = useEqualizer(s => s.gains)
  const preset = useEqualizer(s => s.preset)
  const { apply, setBand } = useEqualizer.getState()
  return (
    <div className="space-y-4">
      <div className={`flex items-center justify-between ${compact ? '' : 'mb-4'}`}>
        <div>
          <p className="text-sm text-white font-medium">{t('10-Band EQ')}</p>
          <p className="text-xs text-muted mt-1">{t('Preset: {name}', { name: t(preset === 'custom' ? 'Custom' : EQ_PRESETS[preset]?.label || EQ_PRESETS[DEFAULT_EQ_PRESET].label) })}</p>
        </div>
        <button onClick={() => apply(EQ_PRESETS[DEFAULT_EQ_PRESET].gains, DEFAULT_EQ_PRESET)}
          className="text-xs text-muted hover:text-white transition-colors">{t('Reset')}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {Object.entries(EQ_PRESETS).map(([key, item]) => (
          <button
            key={key}
            onClick={() => apply(item.gains, key)}
            className={`px-3 py-1.5 rounded-lg text-xs border transition-colors ${preset === key ? 'bg-accent/20 border-accent/50 text-accent' : 'bg-card border-border text-muted hover:text-white'}`}
          >
            {t(item.label)}
          </button>
        ))}
      </div>
      <div className={`flex items-end justify-center ${compact ? 'gap-1.5' : 'gap-3'} h-40 overflow-x-auto pb-2`}>
        {EQ_BANDS.map((band, i) => (
          <div key={band} className="flex flex-col items-center gap-2">
            <span className="text-xs font-display" style={{ color: '#e8ff57', fontSize: 10 }}>
              {gains[i] > 0 ? '+' : ''}{(gains[i] || 0).toFixed(1)}
            </span>
            <input type="range" min={-12} max={12} step={0.5} value={gains[i] || 0}
              onChange={e => setBand(i, parseFloat(e.target.value))}
              className="accent-accent"
              style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 24, height: 104, cursor: 'pointer' }} />
            <span className="text-muted" style={{ fontSize: 9 }}>{band}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted mt-3 text-center opacity-50">{t('The equalizer starts after your first click in the app.')}</p>
    </div>
  )
}
