// `npm run build`: the build number (Settings > About, under the version)
// goes up by one every time the app is built. Kept in build-number.json.

const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'build-number.json')
let current = 0
try { current = Number(JSON.parse(fs.readFileSync(file, 'utf8')).build) || 0 } catch {}
const next = current + 1
fs.writeFileSync(file, JSON.stringify({ build: next }, null, 2) + '\n')
console.log(`[build] build number ${next}`)
