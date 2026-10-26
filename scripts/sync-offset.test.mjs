import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  browserOutputNames, clampSyncOffset, deviceKey, deviceKind, plainDeviceName,
  readDeviceMap, rememberDevices, resolveBrowserOutput,
} from '../src/syncOffsetCore.js'

test('offsets stay within ±3 s in hundredths, typed with a dot or a comma', () => {
  assert.equal(clampSyncOffset(0.256), 0.26)
  assert.equal(clampSyncOffset('0,15'), 0.15)
  assert.equal(clampSyncOffset(-7), -3)
  assert.equal(clampSyncOffset(9), 3)
  assert.equal(clampSyncOffset('abc'), 0)
  assert.equal(clampSyncOffset(-0.001), 0)
})

test("Chromium's default alias names the device it points at, in any language", () => {
  assert.equal(plainDeviceName('Default - Headphones (WH-1000XM4 Stereo)'), 'Headphones (WH-1000XM4 Stereo)')
  assert.equal(plainDeviceName('По умолчанию - Динамики (Realtek(R) Audio)'), 'Динамики (Realtek(R) Audio)')
  assert.equal(deviceKey('  Speakers   (Realtek) '), 'speakers (realtek)')
  assert.equal(deviceKey('Default - Speakers (Realtek)'), deviceKey('Speakers (Realtek)'))
})

test('device kinds are guessed from the name', () => {
  assert.equal(deviceKind('Headphones (WH-1000XM4 Stereo)'), 'bluetooth')
  assert.equal(deviceKind('Наушники (AirPods Pro)'), 'bluetooth')
  assert.equal(deviceKind('Headset (Hands-Free AG Audio)'), 'bluetooth')
  assert.equal(deviceKind('Наушники (Realtek(R) Audio)'), 'headphones')
  assert.equal(deviceKind('Динамики (Realtek(R) Audio)'), 'speaker')
})

const devices = [
  { kind: 'audiooutput', deviceId: 'default', groupId: 'g2', label: 'Default - Headphones (Buds2)' },
  { kind: 'audiooutput', deviceId: 'communications', groupId: 'g1', label: 'Communications - Speakers (Realtek)' },
  { kind: 'audiooutput', deviceId: 'a', groupId: 'g1', label: 'Speakers (Realtek)' },
  { kind: 'audiooutput', deviceId: 'b', groupId: 'g2', label: 'Headphones (Buds2)' },
  { kind: 'audioinput', deviceId: 'mic', groupId: 'g2', label: 'Microphone (Buds2)' },
]

test('the default output resolves to the real device behind it', () => {
  assert.equal(resolveBrowserOutput(devices, 'default'), 'Headphones (Buds2)')
  assert.equal(resolveBrowserOutput(devices, 'a'), 'Speakers (Realtek)')
  assert.equal(resolveBrowserOutput(devices, 'gone'), 'Headphones (Buds2)')
  assert.equal(resolveBrowserOutput([], 'default'), '')
  assert.deepEqual(browserOutputNames(devices), ['Speakers (Realtek)', 'Headphones (Buds2)'])
})

test('new devices are remembered with offset 0, known ones keep theirs', () => {
  const known = { 'speakers (realtek)': { name: 'Speakers (Realtek)', offset: 0.2, seenAt: 1000 } }
  const next = rememberDevices(known, ['Speakers (Realtek)', 'Headphones (Buds2)'], 2000)
  assert.equal(next['speakers (realtek)'].offset, 0.2)
  assert.deepEqual(next['headphones (buds2)'], { name: 'Headphones (Buds2)', offset: 0, seenAt: 2000 })
  assert.equal(rememberDevices(next, ['Headphones (Buds2)'], 3000), next, 'nothing new: same object')
})

test('a saved map is read back safely', () => {
  assert.deepEqual(readDeviceMap('not json'), {})
  assert.deepEqual(readDeviceMap(JSON.stringify({ devices: { x: { name: 'X', offset: 12 }, y: { offset: 1 } } })), { x: { name: 'X', offset: 3, seenAt: 0 } })
})
