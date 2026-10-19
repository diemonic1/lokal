// Settings > Visualizations > Side Panel > Trails: how the saved settings
// are read (src/visualizers/trailsSettings.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { TRAILS_DEFAULTS, TRAILS_SETTING_KEYS, readTrailsSettings } from '../src/visualizers/trailsSettings.js'

test('unset settings read as the defaults', () => {
  assert.deepEqual(readTrailsSettings(() => undefined), TRAILS_DEFAULTS)
})

test('saved settings are read, kept in range, and the colour mode is one of two', () => {
  const saved = { side_trails_life: '150', side_trails_color_mode: 'custom', side_trails_color_1: '#112233', side_trails_count: '5', side_trails_speed: 'fast' }
  const read = readTrailsSettings(key => saved[key])
  assert.equal(read.life, 100)
  assert.equal(read.colorMode, 'custom')
  assert.equal(read.color1, '#112233')
  assert.equal(read.count, 100)
  assert.equal(read.speed, TRAILS_DEFAULTS.speed)
  assert.equal(readTrailsSettings(key => (key === 'side_trails_color_mode' ? 'rainbow' : undefined)).colorMode, 'classic')
  assert.equal(readTrailsSettings(key => (key === 'side_trails_layout' ? 'fill' : undefined)).layout, 'fill')
  assert.equal(readTrailsSettings(key => (key === 'side_trails_layout' ? 'grid' : undefined)).layout, 'circle')
  assert.equal(readTrailsSettings(key => (key === 'side_trails_scale' ? '1000' : undefined)).scale, 300)
  assert.ok(TRAILS_SETTING_KEYS.every(key => key.startsWith('side_trails_')))
})
