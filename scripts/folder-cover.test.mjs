// A folder's own picture is kept as folder_cover.lokal (electron/folderCover.js)
// so galleries on other devices syncing the music folder don't show it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readFolderCover, decode, isFolderCoverName } = require('../electron/folderCover.js')
const { folderCoverFile, clearFolderCoverCache } = require('../electron/libraryFolder.js')

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 8, 7])

function tempFolder() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lokal-folder-cover-'))
}

test('a folder_cover.jpg becomes folder_cover.lokal, which is no longer a picture', () => {
  clearFolderCoverCache()
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, 'folder_cover.jpg'), JPEG)
  const found = folderCoverFile(folder)
  assert.equal(path.basename(found.path), 'folder_cover.lokal')
  assert.deepEqual(fs.readdirSync(folder), ['folder_cover.lokal'])
  const stored = fs.readFileSync(found.path)
  assert.ok(!stored.includes(Buffer.from([0xff, 0xd8, 0xff])), 'no JPEG signature left in the file')
  assert.deepEqual(readFolderCover(found.path), { bytes: JPEG, mime: 'image/jpeg' })
})

test('a new folder_cover.png added later replaces the stored one', async () => {
  clearFolderCoverCache()
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, 'Folder_Cover.JPG'), JPEG)
  folderCoverFile(folder)
  await new Promise(resolve => setTimeout(resolve, 30))
  fs.writeFileSync(path.join(folder, 'folder_cover.png'), PNG)
  const found = folderCoverFile(folder)
  assert.deepEqual(fs.readdirSync(folder).sort(), ['folder_cover.lokal'])
  assert.deepEqual(readFolderCover(found.path), { bytes: PNG, mime: 'image/png' })
})

test('no cover, other files, and names the protocol accepts', () => {
  clearFolderCoverCache()
  const folder = tempFolder()
  fs.writeFileSync(path.join(folder, 'cover.jpg'), JPEG)
  assert.equal(folderCoverFile(folder), null)
  assert.equal(decode(Buffer.from('not a cover')), null)
  assert.ok(isFolderCoverName('C:\\Music\\A\\folder_cover.lokal'))
  assert.ok(!isFolderCoverName('C:\\Windows\\secret.txt'))
})
