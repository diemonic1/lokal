// `npm run build`, last step: release/win-unpacked/<version>_B<build>.txt says
// which version and build were just made (the one from the build before is
// removed). electron-builder's own notes (builder-debug.yml,
// builder-effective-config.yaml) are removed from release/: it always writes
// them and nothing uses them.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const release = path.join(root, 'release')
const unpacked = path.join(release, 'win-unpacked')
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
let build = 0
try { build = Number(JSON.parse(fs.readFileSync(path.join(root, 'build-number.json'), 'utf8')).build) || 0 } catch {}

const isInfo = name => /^.+_B\d+\.txt$/.test(name)
for (const dir of [release, unpacked]) {
  let names = []
  try { names = fs.readdirSync(dir) } catch {}
  for (const name of names) if (isInfo(name)) fs.rmSync(path.join(dir, name), { force: true })
}
for (const name of ['builder-debug.yml', 'builder-effective-config.yaml']) fs.rmSync(path.join(release, name), { force: true })

fs.mkdirSync(unpacked, { recursive: true })
const name = `${version}_B${build}.txt`
fs.writeFileSync(path.join(unpacked, name), `Version: ${version}\r\nBuild: ${build}\r\n`)
console.log(`[build] win-unpacked/${name}`)
