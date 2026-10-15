// The comment tag inside the audio file -- written when it's changed in the
// tag editor. Only the ordinary comment is replaced (ID3v2: the COMM frame
// without a description); frames with one stay as they are -- a player's own
// (iTunNORM...) or a downloader's ("n": "Converted by ...").

const fs = require('fs')

let taglib = null
function lib() {
  if (taglib === null) {
    try { taglib = require('node-taglib-sharp') } catch { taglib = false }
  }
  return taglib || null
}

function writeId3(T, file, text) {
  const id3 = file.getTag(T.TagTypes.Id3v2, true)
  const frames = id3.getFramesByClassType(T.Id3v2FrameClassType.CommentsFrame) || []
  const own = frames.filter(frame => !String(frame.description || '').trim())
  const model = own[0] || null
  const language = model?.language && model.language.length === 3 ? model.language : 'eng'
  for (const frame of own) id3.removeFrame(frame)
  if (!text) return
  const frame = T.Id3v2CommentsFrame.fromDescription('', language, T.StringType.UTF16)
  frame.text = text
  id3.addFrame(frame)
}

/** Empty text removes the comment. */
function writeFileComment(filePath, text) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  const clean = String(text || '').replace(/\r\n?/g, '\n').trim()
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    if (mp3) writeId3(T, file, clean)
    else file.tag.comment = clean || undefined
    // taglib adds an ID3v1 tag to MP3s that never had one; don't.
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
  return clean
}

module.exports = { writeFileComment }

/**
 * The genre tag, one value per genre (ID3v2.4 TCON holds several; the tag
 * editor's genres). An empty list removes it.
 */
function writeFileGenres(filePath, genres) {
  const T = lib()
  if (!T) throw new Error('Tag writer unavailable')
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found')
  const list = (Array.isArray(genres) ? genres : []).map(value => String(value || '').trim()).filter(Boolean)
  let file
  try {
    file = T.File.createFromPath(filePath)
    const mp3 = /\.mp3$/i.test(filePath)
    const hadId3v1 = typeof file.tagTypesOnDisk === 'number' && (file.tagTypesOnDisk & T.TagTypes.Id3v1) !== 0
    file.tag.genres = list
    if (mp3 && !hadId3v1) { try { file.removeTags(T.TagTypes.Id3v1) } catch {} }
    file.save()
  } catch (e) {
    const busy = /EBUSY|EPERM|EACCES/i.test(String(e?.code || e?.message || ''))
    throw new Error(busy ? 'The file is in use or read-only' : (e?.message || String(e)))
  } finally {
    try { file?.dispose() } catch {}
  }
}

module.exports.writeFileGenres = writeFileGenres
