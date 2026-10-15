import assert from 'node:assert/strict'
import { test } from 'node:test'

// ImageZoom.jsx is JSX: `npm test` compiles it (scripts/test-hooks.mjs).
import { largerImage } from '../src/components/ImageZoom.jsx'

test('online pictures are asked for in a larger size; others are left as they are', () => {
  assert.equal(largerImage('https://lh3.googleusercontent.com/abc=w120-h120-l90-rj'), 'https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj')
  assert.equal(largerImage('https://yt3.ggpht.com/xyz=s88-c-k-c0x00ffffff-no-rj'), 'https://yt3.ggpht.com/xyz=s1200')
  assert.equal(largerImage('https://is1-ssl.mzstatic.com/image/thumb/a/b/600x600bb.jpg'), 'https://is1-ssl.mzstatic.com/image/thumb/a/b/1200x1200bb.jpg')
  assert.equal(largerImage('file:///music/cover.jpg'), 'file:///music/cover.jpg')
  assert.equal(largerImage('https://i.scdn.co/image/ab67'), 'https://i.scdn.co/image/ab67')
})
