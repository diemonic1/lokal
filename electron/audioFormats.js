// The audio files the quick player (./quick/main.js) opens: double-clicked in
// Explorer, or "Open with" Lokal. Chromium plays the first group itself; the
// second is converted once with ffmpeg (./download/convert.js playableCopy)
// and played from the cache. The library scanner keeps its own, shorter list
// (./ipc/scanner.js AUDIO_EXTS).

const path = require('path')
const fs = require('fs')

const NATIVE_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.mp4', '.m4b', '.aac', '.webm', '.weba']
const FFMPEG_EXTS = ['.alac', '.ape', '.wma', '.wv', '.tta', '.dsf', '.dff', '.aif', '.aiff', '.aifc', '.ac3', '.eac3', '.dts', '.mka', '.mpc']
const QUICK_EXTS = new Set([...NATIVE_EXTS, ...FFMPEG_EXTS])

const isQuickAudioFile = (name) => QUICK_EXTS.has(path.extname(String(name || '')).toLowerCase())

/** The first argument that is an audio file on disk (Chromium's own switches and lokal:// links skipped), or ''. */
function findQuickFileArg(argv = []) {
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(arg)) continue
    if (!isQuickAudioFile(arg)) continue
    try { if (fs.statSync(arg).isFile()) return path.resolve(arg) } catch {}
  }
  return ''
}

module.exports = { NATIVE_EXTS, FFMPEG_EXTS, QUICK_EXTS, isQuickAudioFile, findQuickFileArg }
