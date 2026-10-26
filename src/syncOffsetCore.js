// Sync offset per audio output: how much later (positive) or earlier
// (negative) lyrics, music videos and visualizations are shown than the
// player's position, for one output. Bluetooth headphones and speakers play
// what they're sent a fraction of a second late, so what's on screen would
// run ahead of what's heard; their offset holds it back. The sound itself is
// never moved. Pure helpers here (tested in scripts/sync-offset.test.mjs),
// the store and device tracking in syncOffset.js.

export const SYNC_OFFSET_MAX = 3
export const SYNC_OFFSET_STEP = 0.01

/** Seconds kept within ±3 and rounded to hundredths (0 for anything unreadable). */
export function clampSyncOffset(seconds) {
  const n = Number(String(seconds ?? '').replace(',', '.'))
  if (!Number.isFinite(n)) return 0
  const value = Math.round(Math.max(-SYNC_OFFSET_MAX, Math.min(SYNC_OFFSET_MAX, n)) * 100) / 100
  return Object.is(value, -0) ? 0 : value
}

// Chromium names the system's default and communications outputs after the
// device they point at ("Default - Speakers (Realtek)"); Windows does it in
// its own language.
const ALIAS_PREFIX = /^(default|communications|по умолчанию|связь|standard|kommunikation|par défaut|predeterminado|predefinito|padrão|standaard|domyślne|komunikacja)\s*[-–—:]\s*/i

/** A device label without the "Default - " Chromium puts on the alias entries. */
export function plainDeviceName(label) {
  return String(label || '').trim().replace(ALIAS_PREFIX, '').trim()
}

/** The key a device's offset is kept under: its name, so it's the same in Auto and native output. */
export function deviceKey(name) {
  return plainDeviceName(name).toLowerCase().replace(/\s+/g, ' ')
}

const BLUETOOTH = /bluetooth|hands-?free|a2dp|airpods|\bbuds\b|\bwh-|\bwf-|\bjbl\b|bose|beats|soundcore|\bmarshall\b|\bstereo\)?$/i
const HEADPHONES = /head(?:phone|set)|earbud|earphone|наушник|гарнитур|kopfhörer|casque|auricular|cuffi|fones|koptelefoon|słuchawk|hörlurar/i
const SPEAKERS = /speakers?|monitors?|динамик|колонк|lautsprecher|haut-parleur|altavoz|altoparlant|alto-falante|luidspreker|głośnik|högtalare|hdmi|display/i

/**
 * What kind of output a name looks like: 'bluetooth', 'headphones' or
 * 'speaker'. A guess from the name only; it picks the icon and the hint.
 */
export function deviceKind(name) {
  const text = plainDeviceName(name)
  if (BLUETOOTH.test(text)) return 'bluetooth'
  if (HEADPHONES.test(text)) return 'headphones'
  if (SPEAKERS.test(text)) return 'speaker'
  return 'speaker'
}

/**
 * The real output behind a browser output id: for 'default' (and
 * 'communications') the device with the same groupId, else the device itself.
 * Returns its name, or '' while the browser hides labels.
 */
export function resolveBrowserOutput(devices, outputDeviceId = 'default') {
  const list = (devices || []).filter(d => d && d.kind === 'audiooutput')
  const id = outputDeviceId || 'default'
  const picked = list.find(d => (d.deviceId || 'default') === id) || list.find(d => d.deviceId === 'default')
  if (!picked) return ''
  if (picked.deviceId === 'default' || picked.deviceId === 'communications') {
    const real = list.find(d => d.deviceId !== 'default' && d.deviceId !== 'communications' && d.groupId && d.groupId === picked.groupId)
    if (real?.label) return plainDeviceName(real.label)
  }
  return plainDeviceName(picked.label)
}

/** Names of the real outputs in a browser device list (aliases left out, no blanks). */
export function browserOutputNames(devices) {
  return (devices || [])
    .filter(d => d && d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => plainDeviceName(d.label))
    .filter(Boolean)
}

/**
 * `known` ({ key: { name, offset, seenAt } }) with `names` added (offset 0)
 * and their seenAt refreshed. Returns the same object when nothing is new,
 * so a store can skip saving.
 */
export function rememberDevices(known, names, now = Date.now()) {
  let next = known || {}
  for (const name of names || []) {
    const key = deviceKey(name)
    if (!key) continue
    const entry = next[key]
    if (entry && entry.name === plainDeviceName(name) && now - (entry.seenAt || 0) < 24 * 3600e3) continue
    if (next === known) next = { ...known }
    next[key] = { offset: 0, ...entry, name: plainDeviceName(name), seenAt: now }
  }
  return next
}

/** A saved device map read back safely: only entries with a name, offsets clamped. */
export function readDeviceMap(raw) {
  let data
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return {} }
  const devices = data && typeof data === 'object' ? data.devices : null
  if (!devices || typeof devices !== 'object' || Array.isArray(devices)) return {}
  const out = {}
  for (const [key, entry] of Object.entries(devices)) {
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) continue
    out[deviceKey(key) || key] = { name: entry.name.trim(), offset: clampSyncOffset(entry.offset), seenAt: Number(entry.seenAt) || 0 }
  }
  return out
}
