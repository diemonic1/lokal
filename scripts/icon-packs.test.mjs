// AIMP icon packs (electron/iconPacks.js) and the registry text for Lokal's
// file types (electron/ipc/fileIcons.js), on a small DLL made here: a map and
// two icons, no AIMP files in the repository.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const iconPacks = require('../electron/iconPacks.js')
const { ICON_HANDLER_CLSID, registryText, removalText, handlerFromQuery } = require('../electron/ipc/fileIcons.js')

const SECTION_RVA = 0x1000
const SECTION_RAW = 0x200

/** A resource-only PE: types [{ id, items: [{ id, data }] }], ids numbers or names. */
function makeDll(types) {
  // The tree first (directories, then names, then data entries), then the data.
  const chunks = []
  let size = 0
  const put = (buf) => { const at = size; chunks.push(buf); size += buf.length; return at }
  const dirSize = (n) => 16 + 8 * n
  const rootAt = put(Buffer.alloc(dirSize(types.length)))
  const typeDirs = types.map(type => put(Buffer.alloc(dirSize(type.items.length))))
  const langDirs = types.map(type => type.items.map(() => put(Buffer.alloc(dirSize(1)))))
  const nameAt = new Map()
  for (const name of new Set(types.flatMap(type => [type.id, ...type.items.map(item => item.id)]).filter(id => typeof id === 'string'))) {
    const buf = Buffer.alloc(2 + name.length * 2)
    buf.writeUInt16LE(name.length, 0)
    buf.write(name, 2, 'utf16le')
    nameAt.set(name, put(buf))
  }
  const leafAt = types.map(type => type.items.map(() => put(Buffer.alloc(16))))
  const dataAt = types.map(type => type.items.map(item => put(Buffer.concat([item.data, Buffer.alloc((4 - item.data.length % 4) % 4)]))))
  const tree = Buffer.concat(chunks)
  const entry = (dir, i, id, target) => {
    tree.writeUInt32LE(typeof id === 'string' ? (nameAt.get(id) | 0x80000000) >>> 0 : id, dir + 16 + i * 8)
    tree.writeUInt32LE(target >>> 0, dir + 20 + i * 8)
  }
  const header = (dir, named, ids) => { tree.writeUInt16LE(named, dir + 12); tree.writeUInt16LE(ids, dir + 14) }
  const named = (list) => list.filter(x => typeof x.id === 'string').length
  header(rootAt, named(types), types.length - named(types))
  types.forEach((type, t) => {
    entry(rootAt, t, type.id, (typeDirs[t] | 0x80000000) >>> 0)
    header(typeDirs[t], named(type.items), type.items.length - named(type.items))
    type.items.forEach((item, i) => {
      entry(typeDirs[t], i, item.id, (langDirs[t][i] | 0x80000000) >>> 0)
      header(langDirs[t][i], 0, 1)
      entry(langDirs[t][i], 0, 1033, leafAt[t][i])
      tree.writeUInt32LE(SECTION_RVA + dataAt[t][i], leafAt[t][i])
      tree.writeUInt32LE(item.data.length, leafAt[t][i] + 4)
    })
  })
  const pe = 0x40
  const opt = pe + 24
  const optSize = 96 + 16 * 8
  const head = Buffer.alloc(SECTION_RAW)
  head.writeUInt16LE(0x5a4d, 0)
  head.writeUInt32LE(pe, 0x3c)
  head.writeUInt32LE(0x4550, pe)
  head.writeUInt16LE(0x14c, pe + 4)
  head.writeUInt16LE(1, pe + 6)
  head.writeUInt16LE(optSize, pe + 20)
  head.writeUInt16LE(0x10b, opt)
  head.writeUInt32LE(SECTION_RVA, opt + 96 + 2 * 8)
  head.writeUInt32LE(tree.length, opt + 96 + 2 * 8 + 4)
  const section = opt + optSize
  head.write('.rsrc', section, 'latin1')
  head.writeUInt32LE(tree.length, section + 8)
  head.writeUInt32LE(SECTION_RVA, section + 12)
  head.writeUInt32LE(tree.length, section + 16)
  head.writeUInt32LE(SECTION_RAW, section + 20)
  return Buffer.concat([head, tree])
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image')])
const BMP = Buffer.from([0x28, 0, 0, 0, 1, 2, 3, 4])

/** A GRPICONDIR of [{ width, bits, id, size }]. */
function group(entries) {
  const buf = Buffer.alloc(6 + 14 * entries.length)
  buf.writeUInt16LE(1, 2)
  buf.writeUInt16LE(entries.length, 4)
  entries.forEach((e, i) => {
    const at = 6 + i * 14
    buf[at] = e.width >= 256 ? 0 : e.width
    buf[at + 1] = e.width >= 256 ? 0 : e.width
    buf.writeUInt16LE(1, at + 4)
    buf.writeUInt16LE(e.bits, at + 6)
    buf.writeUInt32LE(e.size, at + 8)
    buf.writeUInt16LE(e.id, at + 12)
  })
  return buf
}

const MAP = `<?xml version="1.0"?>
<IconsLibrary>
  <name>Test &amp; Pack</name>
  <author>by someone</author>
  <icon id="0" Exts="*.fla;*.flac;" />
  <icon id="1" Exts="*.mp3;*.mp2;" />
  <icon id="9" Exts="*.ogg;" />
  <icon id="1" type="audio" />
  <icon id="0" type="playlists" />
</IconsLibrary>`

const dll = makeDll([
  { id: 3, items: [{ id: 1, data: BMP }, { id: 2, data: PNG }, { id: 3, data: BMP }] },
  { id: 14, items: [
    { id: 1, data: group([{ width: 32, bits: 32, id: 1, size: BMP.length }]) },
    { id: 2, data: group([{ width: 48, bits: 32, id: 3, size: BMP.length }, { width: 256, bits: 32, id: 2, size: PNG.length }]) },
  ] },
  { id: 'XML', items: [{ id: 'MAP', data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(MAP, 'utf16le')]) }] },
])

test('an AIMP pack: its name, author and which icon each type gets', () => {
  const pack = iconPacks.readPackBuffer(dll)
  assert.equal(pack.name, 'Test & Pack')
  assert.equal(pack.author, 'by someone')
  assert.equal(pack.count, 2)
  assert.deepEqual(pack.map, { '.fla': 0, '.flac': 0, '.mp3': 1, '.mp2': 1, '.ogg': 9 })
  assert.equal(pack.audio, 1)
  assert.equal(iconPacks.packIndexFor(pack, '.flac'), 0)
  // Not in the map: the pack's "audio" icon; an icon the DLL doesn't have: the same.
  assert.equal(iconPacks.packIndexFor(pack, '.wav'), 1)
  assert.equal(iconPacks.packIndexFor(pack, '.ogg'), 1)
  assert.equal(iconPacks.packIndexFor({ ...pack, audio: null }, '.wav'), null)
})

test('a pack icon for the preview: the largest image, a PNG as it is, a bitmap as a one-image .ico', () => {
  assert.equal(iconPacks.packIconBuffer(dll, 1), `data:image/png;base64,${PNG.toString('base64')}`)
  const ico = Buffer.from(iconPacks.packIconBuffer(dll, 0).split(',')[1], 'base64')
  assert.match(iconPacks.packIconBuffer(dll, 0), /^data:image\/x-icon;base64,/)
  assert.equal(ico.readUInt16LE(2), 1)
  assert.equal(ico.readUInt16LE(4), 1)
  assert.equal(ico[6], 32)
  assert.equal(ico.readUInt32LE(14), BMP.length)
  assert.equal(ico.readUInt32LE(18), 22)
  assert.deepEqual(ico.subarray(22), BMP)
  assert.equal(iconPacks.packIconBuffer(dll, 5), null)
})

test('a DLL that is not a pack is refused', () => {
  assert.throws(() => iconPacks.readPackBuffer(Buffer.from('not a dll at all, just text')))
  assert.throws(() => iconPacks.readPackBuffer(makeDll([{ id: 14, items: [{ id: 1, data: group([]) }] }])), /No icon map/)
})

test('registry text: Lokal\'s type for each extension, opening with the exe, icon, covers', () => {
  const icons = { '.mp3': '"C:\\Пак\\icons\\pack.dll",1' }
  const text = registryText({
    exe: 'S:\\Programs\\Lokal\\Lokal Player.exe',
    icons: new Proxy(icons, { get: (target, ext) => target[ext] ?? `"C:\\res\\${String(ext).slice(1)}.ico",0` }),
    thumbnails: { '.mp3': '{9DBD2C50-62AD-11D0-B806-00C04FD706EC}' },
    coversEverywhere: true,
  })
  assert.match(text, /^Windows Registry Editor Version 5\.00\r\n/)
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\shell\\open\\command]\r\n@="\\"S:\\\\Programs\\\\Lokal\\\\Lokal Player.exe\\" \\"%1\\""'))
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\DefaultIcon]\r\n@="\\"C:\\\\Пак\\\\icons\\\\pack.dll\\",1"'))
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}]\r\n@="{9DBD2C50-62AD-11D0-B806-00C04FD706EC}"'))
  // No thumbnail handler of its own on the extension: none written for it.
  assert.ok(!text.includes('Lokal.Audio.wav\\ShellEx'))
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\.flac\\OpenWithProgids]\r\n"Lokal.Audio.flac"=hex(0):'))
  assert.ok(text.includes('"TypeOverlay"=""'))
  assert.equal(text.split('"ThumbnailCutoff"=dword:00000001').length - 1, 27)
  const plain = registryText({ exe: 'C:\\L.exe', icons: new Proxy({}, { get: () => '"x.ico",0' }), coversEverywhere: false })
  assert.ok(!plain.includes('ThumbnailCutoff'))
  // Each type is cleared first, so nothing from an earlier set stays.
  assert.ok(text.indexOf('[-HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3]') < text.indexOf('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3]'))
})

test('removal text takes every type and "Open with" entry out', () => {
  const text = removalText()
  assert.ok(text.includes('[-HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3]'))
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\.mp3\\OpenWithProgids]\r\n"Lokal.Audio.mp3"=-'))
  assert.equal(text.split('=-').length - 1, 27)
})

test('the thumbnail handler read from reg query: the value, not the id in the key\'s own path', () => {
  const output = [
    '',
    'HKEY_CLASSES_ROOT\\.mp3\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}',
    '    (Default)    REG_SZ    {9DBD2C50-62AD-11D0-B806-00C04FD706EC}',
    '',
  ].join('\r\n')
  assert.equal(handlerFromQuery(output), '{9DBD2C50-62AD-11D0-B806-00C04FD706EC}')
  assert.equal(handlerFromQuery('HKEY_CLASSES_ROOT\\.wav\\ShellEx\\{e357fccd-a995-4576-b01f-234630154e96}\r\n    (Default)    REG_SZ    (value not set)'), null)
})

test('covers as icons: the icon handler registered, each type\'s icon its file\'s own, the set\'s as the fallback', () => {
  const icons = new Proxy({}, { get: (_, ext) => `"C:\\res\\${String(ext).slice(1)}.ico",0` })
  const text = registryText({ exe: 'C:\\L.exe', icons, iconHandler: { dll: 'C:\\Users\\u\\AppData\\Local\\lokal-music\\shell\\LokalIconHandler-abc.dll' } })
  const clsid = `HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\${ICON_HANDLER_CLSID}`
  assert.ok(text.includes(`[${clsid}\\InprocServer32]\r\n@="C:\\\\Users\\\\u\\\\AppData\\\\Local\\\\lokal-music\\\\shell\\\\LokalIconHandler-abc.dll"\r\n"ThreadingModel"="Apartment"`))
  assert.ok(text.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\DefaultIcon]\r\n@="%1"'))
  assert.ok(text.includes(`[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\ShellEx\\IconHandler]\r\n@="${ICON_HANDLER_CLSID}"`))
  assert.ok(text.includes('"LokalFallbackIcon"="\\"C:\\\\res\\\\mp3.ico\\",0"'))
  // Without it: the set's icon as the type's own, and no handler left registered.
  const plain = registryText({ exe: 'C:\\L.exe', icons })
  assert.ok(plain.includes(`[-${clsid}]`))
  assert.ok(!plain.includes('InprocServer32') && !plain.includes('IconHandler') && !plain.includes('LokalFallbackIcon'))
  assert.ok(plain.includes('[HKEY_CURRENT_USER\\Software\\Classes\\Lokal.Audio.mp3\\DefaultIcon]\r\n@="\\"C:\\\\res\\\\mp3.ico\\",0"'))
  assert.ok(removalText().includes(`[-${clsid}]`))
})
