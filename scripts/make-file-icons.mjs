// Makes Lokal's own file icons (Settings > File Icons, the built-in set):
// build/file-icons/template.png -- a pink file with a note and "MP3" on its
// label -- with each audio type's name on the label instead, as a
// multi-size .ico per extension in build/file-icons/. The icons are kept in
// the repository and copied into the build (package.json extraResources);
// run this again only to change them:
//
//   node scripts/make-file-icons.mjs
//
// Windows only (the label's font is Segoe UI Black, from C:\Windows\Fonts).

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
const { QUICK_EXTS } = require('../electron/audioFormats.js')

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = path.join(root, 'build', 'file-icons')
const template = path.join(dir, 'template.png')
const FONT = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'seguibl.ttf')

// The label's white field on the 512 px template, its colour, the text's.
const FIELD = { left: 43, top: 42, width: 257, height: 102 }
const FIELD_COLOR = '#fdf5f8'
const TEXT_COLOR = '#1a0716'
// The text at most this big (the template's "MP3": about 218 x 72 px).
const TEXT_MAX = { width: 228, height: 72 }
const SIZES = [256, 128, 64, 48, 32, 24, 16]

/** The type's name, black on clear, cropped to its ink. */
async function label(text) {
  const rendered = await sharp({
    text: { text: `<span foreground="${TEXT_COLOR}">${text}</span>`, font: 'Segoe UI Black 120', fontfile: FONT, rgba: true, dpi: 72 },
  }).png().toBuffer()
  const trimmed = await sharp(rendered).trim({ threshold: 1 }).png().toBuffer()
  const { width, height } = await sharp(trimmed).metadata()
  const scale = Math.min(TEXT_MAX.width / width, TEXT_MAX.height / height)
  return sharp(trimmed).resize(Math.round(width * scale), Math.round(height * scale)).png().toBuffer({ resolveWithObject: true })
}

/** The 512 px icon for one extension. */
async function iconPng(ext) {
  const { data: text, info } = await label(ext.slice(1).toUpperCase())
  const field = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${FIELD.width}" height="${FIELD.height}"><rect width="100%" height="100%" fill="${FIELD_COLOR}"/></svg>`)
  return sharp(template).composite([
    { input: field, left: FIELD.left, top: FIELD.top },
    {
      input: text,
      left: Math.round(FIELD.left + (FIELD.width - info.width) / 2),
      top: Math.round(FIELD.top + (FIELD.height - info.height) / 2),
    },
  ]).png().toBuffer()
}

/** A .ico of PNG images, one per size. */
async function ico(png) {
  const images = []
  for (const size of SIZES) images.push(await sharp(png).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer())
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach((image, i) => {
    const entry = 6 + i * 16
    const size = SIZES[i]
    header.writeUInt8(size >= 256 ? 0 : size, entry)
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(image.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += image.length
  })
  return Buffer.concat([header, ...images])
}

// --preview=<folder>: each icon also as a 512 px PNG there, to look at.
const preview = process.argv.find(arg => arg.startsWith('--preview='))?.slice('--preview='.length)
if (!fs.existsSync(FONT)) throw new Error(`Font not found: ${FONT}`)
for (const ext of QUICK_EXTS) {
  const png = await iconPng(ext)
  fs.writeFileSync(path.join(dir, `${ext.slice(1)}.ico`), await ico(png))
  if (preview) fs.writeFileSync(path.join(preview, `${ext.slice(1)}.png`), png)
}
console.log(`${QUICK_EXTS.size} icons in ${path.relative(root, dir)}`)
