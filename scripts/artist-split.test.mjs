import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as renderer from '../src/artistNames.js'

const require = createRequire(import.meta.url)
const main = require('../electron/artistSplit.js')

const CASES = [
  ['Ark Patrol (feat. Veronika Redd)', ['Ark Patrol', 'Veronika Redd']],
  ['Ark Patrol feat Veronika Redd', ['Ark Patrol', 'Veronika Redd']],
  ['Ark Patrol ft. Veronika Redd', ['Ark Patrol', 'Veronika Redd']],
  ['Kavinsky & Lovefoxxx [feat. Ark Patrol, Veronika Redd]', ['Kavinsky', 'Lovefoxxx', 'Ark Patrol', 'Veronika Redd']],
  ['GRXVITON/Foyon/Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['GRXVITON \\ Foyon', ['GRXVITON', 'Foyon']],
  ['GRXVITON; Foyon;Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['GRXVITON,Foyon, Rumusen', ['GRXVITON', 'Foyon', 'Rumusen']],
  ['Баста, Скриптонит', ['Баста', 'Скриптонит']],
  ['Tyler, The Creator (feat. Kali Uchis)', ['Tyler, The Creator', 'Kali Uchis']],
  ['Tyler, The Creator/Foyon', ['Tyler, The Creator', 'Foyon']],
  ['AC/DC', ['AC/DC']],
  ['10,000 Maniacs', ['10,000 Maniacs']],
  ['h x m x d', ['h x m x d']],
  ['Daft Punk', ['Daft Punk']],
  ['The Weeknd (Martin Garrix Remix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (Remix Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (martin garrix REMIX)', ['The Weeknd', 'martin garrix']],
  ['The Weeknd (Martin Garrix prod)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (PROD Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (prod. by Martin Garrix)', ['The Weeknd', 'Martin Garrix']],
  ['The Weeknd (Radio Remix)', ['The Weeknd (Radio Remix)']],
  ['Sigur Rós (Live)', ['Sigur Rós (Live)']],
]

test('artist credits split into every credited artist', () => {
  for (const [credit, expected] of CASES) assert.deepEqual(main.splitArtists(credit), expected, credit)
})

test('a credit keeps its own text, with every artist marked', () => {
  const shown = credit => renderer.artistCreditParts(credit).map(part => part.artist ? `[${part.text}]` : part.text).join('')
  assert.equal(shown('Ark Patrol (feat. Veronika Redd)'), '[Ark Patrol] (feat. [Veronika Redd])')
  assert.equal(shown('Ark Patrol feat. Veronika Redd'), '[Ark Patrol] feat. [Veronika Redd]')
  assert.equal(shown('Kavinsky & Lovefoxxx [ft. Ark Patrol/Veronika Redd]'), '[Kavinsky] & [Lovefoxxx] [ft. [Ark Patrol], [Veronika Redd]]')
  assert.equal(shown('GRXVITON/Foyon \\ Rumusen;Hope'), '[GRXVITON], [Foyon], [Rumusen], [Hope]')
  assert.equal(shown('AC/DC'), '[AC/DC]')
  assert.equal(shown('The Weeknd (Martin Garrix Remix)'), '[The Weeknd] ([Martin Garrix] Remix)')
  assert.equal(shown('The Weeknd (prod Martin Garrix)'), '[The Weeknd] (prod [Martin Garrix])')
  assert.equal(shown('Tyler, The Creator (feat. Kali Uchis)'), '[Tyler, The Creator] (feat. [Kali Uchis])')
})

test("the renderer's copy splits the same way", () => {
  const keep = ['GRXVITON/Foyon']
  for (const [credit] of [...CASES, ['GRXVITON/Foyon/Rumusen']]) {
    assert.deepEqual(renderer.splitArtists(credit), main.splitArtists(credit), credit)
    assert.deepEqual(renderer.splitArtists(credit, renderer.keepCommaSet(keep)), main.splitArtists(credit, main.keepCommaSet(keep)), credit)
  }
})
