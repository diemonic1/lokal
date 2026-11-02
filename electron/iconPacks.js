// File icon sets (Settings > File Icons): Lokal's own, built in, and AIMP's
// icon packs dropped into the "icons" folder next to the app's exe.
//
// An AIMP pack is a resource-only DLL: its icons (RT_GROUP_ICON, in order)
// and an XML map (resource "XML" / "MAP") of which icon goes with which
// file types:
//   <IconsLibrary><name>Turkuaz</name><author>by memo-se</author>
//     <icon id="5" Exts="*.mp3;*.mp2;" />  <icon id="6" type="audio" /> ...
// An icon's id is its place among the DLL's icons, from 0: what Windows takes
// as "<dll>",<id> in a file type's DefaultIcon. type="audio" is the one for
// audio files the map doesn't name. Lokal only uses the audio ones (the types
// it opens, ./audioFormats.js QUICK_EXTS): not the playlist, skin or MIDI ones.
//
// The built-in set is one .ico a type, in resources/file-icons/ (made by
// scripts/make-file-icons.mjs), outside app.asar: Explorer reads icons from
// real files only.

const fs = require('fs')
const path = require('path')
const { QUICK_EXTS } = require('./audioFormats')

const RT_ICON = 3
const RT_GROUP_ICON = 14
const BUILTIN = 'builtin'

function isPackaged() {
  try { return require('electron').app.isPackaged } catch { return false }
}

/** Where AIMP packs go: "icons" next to the exe (the repository's own in development). */
function packsDir() {
  return isPackaged() ? path.join(path.dirname(process.execPath), 'icons') : path.join(__dirname, '..', 'icons')
}

/** Lokal's own .ico files. */
function builtinDir() {
  return isPackaged() ? path.join(process.resourcesPath, 'file-icons') : path.join(__dirname, '..', 'build', 'file-icons')
}

const builtinIcon = (ext) => path.join(builtinDir(), `${ext.slice(1)}.ico`)

/** Lokal's icon handler for Explorer (native/icon-handler), shipped beside its icons. */
const iconHandlerDll = () => path.join(builtinDir(), 'LokalIconHandler.dll')

// ---------------------------------------------------------------- PE resources

/** A DLL's resource tree: type -> [{ id, data() }] in the file's order (ids or names). */
function readResources(buf) {
  const need = (ok) => { if (!ok) throw new Error('Not a resource DLL') }
  need(buf.length > 0x40 && buf.readUInt16LE(0) === 0x5a4d)
  const pe = buf.readUInt32LE(0x3c)
  need(pe + 24 < buf.length && buf.readUInt32LE(pe) === 0x4550)
  const sections = buf.readUInt16LE(pe + 6)
  const optSize = buf.readUInt16LE(pe + 20)
  const opt = pe + 24
  const dirs = opt + (buf.readUInt16LE(opt) === 0x20b ? 112 : 96)
  const rsrcRva = buf.readUInt32LE(dirs + 2 * 8)
  need(rsrcRva > 0)
  const table = []
  for (let i = 0, s = opt + optSize; i < sections; i++, s += 40) {
    table.push({ va: buf.readUInt32LE(s + 12), size: Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16)), raw: buf.readUInt32LE(s + 20) })
  }
  const offset = (rva) => {
    const section = table.find(sec => rva >= sec.va && rva < sec.va + sec.size)
    need(section)
    return rva - section.va + section.raw
  }
  const base = offset(rsrcRva)
  const nameOf = (value) => {
    if (!(value & 0x80000000)) return value
    const at = base + (value & 0x7fffffff)
    return buf.toString('utf16le', at + 2, at + 2 + buf.readUInt16LE(at) * 2)
  }
  const entries = (at) => {
    need(at + 16 <= buf.length)
    const count = buf.readUInt16LE(at + 12) + buf.readUInt16LE(at + 14)
    return Array.from({ length: count }, (_, i) => ({ id: nameOf(buf.readUInt32LE(at + 16 + i * 8)), target: buf.readUInt32LE(at + 20 + i * 8) }))
  }
  const types = new Map()
  for (const type of entries(base)) {
    if (!(type.target & 0x80000000)) continue
    const items = entries(base + (type.target & 0x7fffffff)).filter(item => item.target & 0x80000000).map(item => ({
      id: item.id,
      data: () => {
        const lang = entries(base + (item.target & 0x7fffffff))[0]
        const leaf = base + lang.target
        const start = offset(buf.readUInt32LE(leaf))
        return buf.subarray(start, start + buf.readUInt32LE(leaf + 4))
      },
    }))
    types.set(typeof type.id === 'string' ? type.id.toUpperCase() : type.id, items)
  }
  return types
}

const decode = (bytes) => (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.toString('utf16le', 2) : bytes.toString('utf8').replace(/^﻿/, ''))
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1]
const unescape = (text) => String(text || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim()

/** The pack's map: { name, author, map: { '.mp3': 5 }, audio: 6 | null }. */
function parseMap(xml) {
  const map = {}
  let audio = null
  for (const tag of xml.match(/<icon\b[^>]*>/gi) || []) {
    const id = Number(attr(tag, 'id'))
    if (!Number.isInteger(id) || id < 0) continue
    const exts = attr(tag, 'Exts')
    if (exts) {
      for (const pattern of exts.split(';')) {
        const ext = pattern.trim().toLowerCase().replace(/^\*/, '')
        if (/^\.[a-z0-9+]+$/.test(ext) && !(ext in map)) map[ext] = id
      }
    } else if (String(attr(tag, 'type')).toLowerCase() === 'audio') audio = id
  }
  return {
    name: unescape(xml.match(/<name>([\s\S]*?)<\/name>/i)?.[1]),
    author: unescape(xml.match(/<author>([\s\S]*?)<\/author>/i)?.[1]),
    map,
    audio,
  }
}

/** An AIMP pack from its DLL's bytes: its map and how many icons it has. */
function readPackBuffer(buf) {
  const resources = readResources(buf)
  const mapResource = resources.get('XML')?.find(item => String(item.id).toUpperCase() === 'MAP')
  if (!mapResource) throw new Error('No icon map in this DLL')
  const pack = parseMap(decode(mapResource.data()))
  pack.count = (resources.get(RT_GROUP_ICON) || []).length
  return pack
}

/** The icon `index` (its place, from 0) as a data URL: its largest image. */
function packIconBuffer(buf, index) {
  const resources = readResources(buf)
  const group = (resources.get(RT_GROUP_ICON) || [])[index]
  if (!group) return null
  const dir = group.data()
  const count = dir.readUInt16LE(4)
  let best = null
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 14
    const entry = { width: dir[at] || 256, bits: dir.readUInt16LE(at + 6), id: dir.readUInt16LE(at + 12), at }
    if (!best || entry.width > best.width || (entry.width === best.width && entry.bits > best.bits)) best = entry
  }
  const image = best && (resources.get(RT_ICON) || []).find(item => item.id === best.id)?.data()
  if (!image) return null
  if (image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return `data:image/png;base64,${image.toString('base64')}`
  // A bitmap: as a one-image .ico (the group entry is the icon entry, less its id).
  const head = Buffer.alloc(22)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(1, 4)
  dir.copy(head, 6, best.at, best.at + 12)
  head.writeUInt32LE(image.length, 14)
  head.writeUInt32LE(22, 18)
  return `data:image/x-icon;base64,${Buffer.concat([head, image]).toString('base64')}`
}

/** A .ico file's largest image as a data URL (the built-in set's preview). */
function icoPreview(file) {
  let buf
  try { buf = fs.readFileSync(file) } catch { return null }
  if (buf.length < 22 || buf.readUInt16LE(2) !== 1) return null
  let best = null
  for (let i = 0; i < buf.readUInt16LE(4); i++) {
    const at = 6 + i * 16
    const entry = { width: buf[at] || 256, size: buf.readUInt32LE(at + 8), offset: buf.readUInt32LE(at + 12) }
    if (!best || entry.width > best.width) best = entry
  }
  const image = buf.subarray(best.offset, best.offset + best.size)
  return image[0] === 0x89 ? `data:image/png;base64,${image.toString('base64')}` : null
}

// ---------------------------------------------------------------- sets

/** Which icon a type gets in a pack: its own, else the pack's "audio" one, else null (Lokal's). */
function packIndexFor(pack, ext) {
  if (Number.isInteger(pack.map[ext]) && pack.map[ext] < pack.count) return pack.map[ext]
  if (Number.isInteger(pack.audio) && pack.audio < pack.count) return pack.audio
  return null
}

/** The packs in the icons folder (a DLL that isn't one is left out). */
function listPacks() {
  const dir = packsDir()
  let names = []
  try { names = fs.readdirSync(dir).filter(name => /\.dll$/i.test(name)) } catch {}
  const packs = []
  for (const name of names.sort((a, b) => a.localeCompare(b))) {
    const file = path.join(dir, name)
    try { packs.push({ id: name, file, ...readPackBuffer(fs.readFileSync(file)) }) } catch {}
  }
  return packs
}

/** Where each type's icon comes from in a set: ext -> "<file>",<index>. null: the built-in set. */
function iconLocations(pack) {
  const out = {}
  for (const ext of QUICK_EXTS) {
    const index = pack ? packIndexFor(pack, ext) : null
    out[ext] = index != null ? `"${pack.file}",${index}` : `"${builtinIcon(ext)}",0`
  }
  return out
}

// The types shown in a set's preview, and the label each goes by.
const PREVIEW = [['.mp3', 'MP3'], ['.flac', 'FLAC'], ['.wav', 'WAV'], ['.ogg', 'OGG'], ['.opus', 'Opus'], ['.m4a', 'M4A'], ['.aac', 'AAC'], ['.wma', 'WMA'], ['.ape', 'APE'], ['.aiff', 'AIFF'], ['.mpc', 'MPC'], ['.dsf', 'DSD'], ['.mka', 'other']]

/** A set's preview: [{ ext, label, src }]. */
function previewOf(pack) {
  let buf = null
  if (pack) { try { buf = fs.readFileSync(pack.file) } catch {} }
  const cache = new Map()
  return PREVIEW.map(([ext, label]) => {
    const index = pack && buf ? packIndexFor(pack, ext) : null
    let src
    if (index != null) {
      if (!cache.has(index)) { try { cache.set(index, packIconBuffer(buf, index)) } catch { cache.set(index, null) } }
      src = cache.get(index)
    } else src = icoPreview(builtinIcon(ext))
    return { ext, label, src }
  })
}

module.exports = {
  BUILTIN, packsDir, builtinDir, builtinIcon, iconHandlerDll,
  readResources, parseMap, readPackBuffer, packIconBuffer, icoPreview, packIndexFor,
  listPacks, iconLocations, previewOf,
}
