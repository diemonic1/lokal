// `npm run build`, after vite: electron-builder makes the app with the build
// number (build-number.json) as the fourth part of the exe's version
// (Properties > Details: 8.4.0.142 for version 8.4.0, build 142). The app
// itself still shows the two apart (Settings > About).
// Afterwards electron-builder's own notes (builder-debug.yml,
// builder-effective-config.yaml) are removed from release/: it always writes
// them and nothing uses them. So are the <version>_B<build>.txt files older
// builds left in win-unpacked/.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const root = path.join(__dirname, '..')
const release = path.join(root, 'release')
let build = 0
try { build = Number(JSON.parse(fs.readFileSync(path.join(root, 'build-number.json'), 'utf8')).build) || 0 } catch {}

const cli = path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js')
const result = spawnSync(process.execPath, [cli, `-c.buildNumber=${build}`, ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status ?? 1)

const isInfo = name => /^.+_B\d+\.txt$/.test(name)
for (const dir of [release, path.join(release, 'win-unpacked')]) {
  let names = []
  try { names = fs.readdirSync(dir) } catch {}
  for (const name of names) if (isInfo(name)) fs.rmSync(path.join(dir, name), { force: true })
}
for (const name of ['builder-debug.yml', 'builder-effective-config.yaml']) fs.rmSync(path.join(release, name), { force: true })

// The folder for AIMP icon packs (Settings > File Icons, electron/iconPacks.js),
// next to the exe, ready to drop them in: electron-builder leaves no empty folders.
const unpacked = path.join(release, 'win-unpacked')
if (fs.existsSync(unpacked)) {
  const icons = path.join(unpacked, 'icons')
  fs.mkdirSync(icons, { recursive: true })
  fs.writeFileSync(path.join(icons, 'README.txt'), [
    'Папка для наборов иконок файлов AIMP (Настройки > Иконки файлов).',
    '',
    '1. Скачайте набор: https://aimp.ru/?do=catalog&os=desktop&id=1&sort=1',
    '2. Достаньте из архива файл .dll и положите его сюда.',
    '3. В Lokal: Настройки > Иконки файлов > Обновить, выберите набор и нажмите «Применить».',
    '',
    'Folder for AIMP file icon packs (Settings > File Icons).',
    '',
    '1. Download a pack: https://aimp.ru/?do=catalog&os=desktop&id=1&sort=1',
    '2. Take the .dll out of the archive and put it here.',
    '3. In Lokal: Settings > File Icons > Refresh, pick the pack and press Apply.',
    '',
  ].join('\r\n'), 'utf8')
}
