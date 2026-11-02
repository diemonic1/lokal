// Windows: builds Lokal's icon handler for Explorer (native/icon-handler: an
// audio file's cover as its icon in Details and List, Settings > File
// Icons) into build/file-icons/LokalIconHandler.dll, which the build ships
// as resources/file-icons/. Without the C++ build tools the app still
// builds: that switch is then off and the set's icons show instead.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

if (process.platform !== 'win32') return

const root = path.resolve(__dirname, '..')
const cwd = path.join(root, 'native', 'icon-handler')
const output = path.join(root, 'build', 'file-icons', 'LokalIconHandler.dll')
const result = spawnSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--directory', cwd], { cwd: root, stdio: 'inherit' })
const built = path.join(cwd, 'build', 'Release', 'LokalIconHandler.dll')
if (result.error || result.status !== 0 || !fs.existsSync(built)) {
  console.warn('The Explorer icon handler was not built (C++ build tools missing?): covers in Details and List stay off.')
  return
}
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.copyFileSync(built, output)
console.log('Prepared ' + output)
