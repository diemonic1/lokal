import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const motion = require('../electron/artwork/motion.js')

/** Just enough of better-sqlite3 for motion.js: the motion_covers rows and the writes. */
function fakeDb(rows = new Map()) {
  const writes = []
  return {
    rows, writes,
    exec() {},
    prepare: sql => ({
      get: key => (sql.includes('FROM motion_covers') ? rows.get(key) : undefined),
      run: (...args) => {
        writes.push([sql, args])
        if (sql.startsWith('INSERT OR REPLACE INTO motion_covers')) rows.set(args[0], { data: args[1], fetched_at: args[2] })
      },
    }),
  }
}

const SYZYGY = { id: 't-1', title: 'Syzygy', artist: 'Caster/Moon Rush', album: 'The Witching Hour' }
const COMMUNITY = { motion_cover_sources: '["community"]' }

test('the sources are really asked, and what they find is kept', async (t) => {
  let asked = 0
  t.mock.method(globalThis, 'fetch', async () => {
    asked++
    return { ok: true, json: async () => ({ items: [{ song: 'Syzygy', artist: 'Caster', album: 'The Witching Hour', url: 'https://example.com/syzygy.mp4' }] }) }
  })
  const db = fakeDb()
  assert.equal(await motion.checkMotionCover(db, SYZYGY, COMMUNITY), 'community')
  assert.equal(asked, 1)
  const [key, row] = [...db.rows][0]
  assert.match(key, /\|community\|v5$/)
  assert.equal(JSON.parse(row.data).url, 'https://example.com/syzygy.mp4')
})

test('a clip found before the v5 key still counts; an old "none" does not', async (t) => {
  let asked = 0
  t.mock.method(globalThis, 'fetch', async () => { asked++; return { ok: true, json: async () => ({ items: [] }) } })
  const base = 'syzygy|caster moon rush|the witching hour|community'
  const hit = fakeDb(new Map([[`${base}|v4`, { data: JSON.stringify({ url: 'https://example.com/old.mp4', source: 'community' }), fetched_at: Date.now() }]]))
  assert.equal(await motion.checkMotionCover(hit, SYZYGY, COMMUNITY), 'community')
  assert.equal(asked, 0)
  // The old "none" is looked up again (the community list is still in memory
  // from the test above, so the clip is found this time).
  const miss = fakeDb(new Map([[`${base}|v4`, { data: null, fetched_at: Date.now() }]]))
  assert.equal(await motion.checkMotionCover(miss, SYZYGY, COMMUNITY), 'community')
  assert.ok(miss.rows.get(`${base}|v5`)?.data)
})
