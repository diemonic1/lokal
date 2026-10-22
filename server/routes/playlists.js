
const router = require('express').Router()
const { smartTracks, smartPreview, normalizeRules, playlistRules } = require('../../electron/playlists/smart')
const fs = require('fs-extra')
const path = require('path')
const { getDB, getStorageDir } = require('../../electron/ipc/db')
const { normalizeIsrc } = require('../../electron/quality')

function parseCsvLine(line) {
  const result = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result.map(s => s.trim())
}

function firstGenre(value) {
  return String(value || '').split(',').map(part => part.trim()).filter(Boolean)[0] || null
}

function normalizeArtistList(value) {
  const parts = String(value || '')
    .split(/\s*[;,]\s*/)
    .map(part => part.trim())
    .filter(Boolean)
  return parts.length ? [...new Set(parts)].join(', ') : null
}

function normalizeGenres(value) {
  const parts = String(value || '').split(',').map(part => part.trim()).filter(Boolean)
  return parts.length ? [...new Set(parts)].join(', ') : null
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseInteger(value) {
  if (value === undefined || value === null || value === '') return null
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseExplicit(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return 0
  return ['1', 'true', 'yes', 'y', 'explicit'].includes(normalized) ? 1 : 0
}

function parseM3U(fileContent) {
  const lines = fileContent.split(/\r?\n/)
  const entries = []
  let currentMeta = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('#EXTM3U')) continue
    if (trimmed.startsWith('#EXTINF:')) {
      const match = trimmed.match(/#EXTINF:(-?\d+),(.+)/)
      if (match) {
        const duration = parseInt(match[1], 10)
        const meta = match[2].trim()
        const dashIndex = meta.lastIndexOf(' - ')
        if (dashIndex > 0) {
          currentMeta = { artist: meta.substring(0, dashIndex).trim(), title: meta.substring(dashIndex + 3).trim(), duration }
        } else {
          currentMeta = { title: meta, artist: null, duration }
        }
      }
      continue
    }
    if (trimmed.startsWith('#') || !trimmed) continue
    entries.push({ file_path: trimmed, title: currentMeta?.title || null, artist: currentMeta?.artist || null, duration: currentMeta?.duration || null })
    currentMeta = null
  }
  return entries
}

function parseCSV(fileContent) {
  const lines = fileContent.split(/\r?\n/).filter(l => l.trim())
  const entries = []
  if (lines.length < 1) return entries
  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase())
  const findCol = names => headers.findIndex(h => names.some(n => h === n || h.includes(n)))
  const titleCol = findCol(['track name', 'trackname', 'song title', 'title', 'name'])
  const artistCol = findCol(['artist name', 'artist', 'performer'])
  const albumCol = findCol(['album name', 'album'])
  const durationCol = findCol(['duration_ms', 'duration ms', 'duration'])
  const urlCol = findCol(['track url', 'url', 'spotify uri', 'uri', 'apple music url', 'youtube url'])
  const genreCol = findCol(['genres', 'genre'])
  const labelCol = findCol(['record label', 'label'])
  const explicitCol = findCol(['explicit'])
  const releaseDateCol = findCol(['release date', 'release_date', 'year'])
  const danceabilityCol = findCol(['danceability'])
  const energyCol = findCol(['energy'])
  const keyCol = findCol(['track key', 'key'])
  const loudnessCol = findCol(['loudness'])
  const modeCol = findCol(['mode'])
  const speechinessCol = findCol(['speechiness'])
  const acousticnessCol = findCol(['acousticness'])
  const instrumentalnessCol = findCol(['instrumentalness'])
  const livenessCol = findCol(['liveness'])
  const valenceCol = findCol(['valence'])
  const tempoCol = findCol(['tempo'])
  const timeSignatureCol = findCol(['time signature'])
  const isrcCol = findCol(['isrc'])
  if (titleCol === -1) return entries
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const title = values[titleCol]
    const artist = artistCol !== -1 ? normalizeArtistList(values[artistCol]) : null
    const album = albumCol !== -1 ? values[albumCol] : null
    const genres = genreCol !== -1 ? normalizeGenres(values[genreCol]) : null
    const releaseDate = releaseDateCol !== -1 ? values[releaseDateCol] : null
    if (title) entries.push({
      title,
      artist,
      album,
      duration: durationCol !== -1 ? require('../../electron/playlists/importDuration').csvDuration(values[durationCol], headers[durationCol]) : null,
      source_url: urlCol !== -1 ? values[urlCol] : null,
      genres,
      genre: firstGenre(genres),
      record_label: labelCol !== -1 ? values[labelCol] || null : null,
      explicit: explicitCol !== -1 ? parseExplicit(values[explicitCol]) : 0,
      year: releaseDate ? parseInteger(String(releaseDate).slice(0, 4)) : null,
      danceability: danceabilityCol !== -1 ? parseNumber(values[danceabilityCol]) : null,
      energy: energyCol !== -1 ? parseNumber(values[energyCol]) : null,
      track_key: keyCol !== -1 ? parseInteger(values[keyCol]) : null,
      loudness: loudnessCol !== -1 ? parseNumber(values[loudnessCol]) : null,
      mode: modeCol !== -1 ? parseInteger(values[modeCol]) : null,
      speechiness: speechinessCol !== -1 ? parseNumber(values[speechinessCol]) : null,
      acousticness: acousticnessCol !== -1 ? parseNumber(values[acousticnessCol]) : null,
      instrumentalness: instrumentalnessCol !== -1 ? parseNumber(values[instrumentalnessCol]) : null,
      liveness: livenessCol !== -1 ? parseNumber(values[livenessCol]) : null,
      valence: valenceCol !== -1 ? parseNumber(values[valenceCol]) : null,
      tempo: tempoCol !== -1 ? parseNumber(values[tempoCol]) : null,
      time_signature: timeSignatureCol !== -1 ? parseInteger(values[timeSignatureCol]) : null,
      // Exportify and similar exports have it: matches the exact recording.
      isrc: isrcCol !== -1 ? normalizeIsrc(values[isrcCol]) : null,
    })
  }
  return entries
}

function parseJSON(fileContent) {
  try {
    const json = JSON.parse(fileContent)
    if (Array.isArray(json)) {
      return json.map(t => ({
        title: t.title || t.name || null,
        artist: normalizeArtistList(t.artist || t.artistName || t.performer || null),
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
        genres: normalizeGenres(t.genres || t.genre),
        genre: firstGenre(t.genres || t.genre),
        record_label: t.record_label || t.label || null,
        explicit: parseExplicit(t.explicit),
        year: parseInteger(t.year || String(t.release_date || '').slice(0, 4)),
        danceability: parseNumber(t.danceability),
        energy: parseNumber(t.energy),
        track_key: parseInteger(t.track_key ?? t.key),
        loudness: parseNumber(t.loudness),
        mode: parseInteger(t.mode),
        speechiness: parseNumber(t.speechiness),
        acousticness: parseNumber(t.acousticness),
        instrumentalness: parseNumber(t.instrumentalness),
        liveness: parseNumber(t.liveness),
        valence: parseNumber(t.valence),
        tempo: parseNumber(t.tempo),
        time_signature: parseInteger(t.time_signature ?? t.timeSignature),
      })).filter(t => t.title || t.file_path)
    }
    if (Array.isArray(json.tracks)) {
      return json.tracks.map(t => ({
        title: t.title || t.name || null,
        artist: normalizeArtistList(t.artist || t.artistName || null),
        album: t.album || t.albumName || null,
        file_path: t.file_path || t.path || null,
        duration: t.duration || t.duration_ms || null,
        source_url: t.source_url || t.url || t.uri || null,
        genres: normalizeGenres(t.genres || t.genre),
        genre: firstGenre(t.genres || t.genre),
        record_label: t.record_label || t.label || null,
        explicit: parseExplicit(t.explicit),
        year: parseInteger(t.year || String(t.release_date || '').slice(0, 4)),
        danceability: parseNumber(t.danceability),
        energy: parseNumber(t.energy),
        track_key: parseInteger(t.track_key ?? t.key),
        loudness: parseNumber(t.loudness),
        mode: parseInteger(t.mode),
        speechiness: parseNumber(t.speechiness),
        acousticness: parseNumber(t.acousticness),
        instrumentalness: parseNumber(t.instrumentalness),
        liveness: parseNumber(t.liveness),
        valence: parseNumber(t.valence),
        tempo: parseNumber(t.tempo),
        time_signature: parseInteger(t.time_signature ?? t.timeSignature),
      })).filter(t => t.title || t.file_path)
    }
  } catch {}
  return []
}

function normalizeImportEntry(entry = {}) {
  return {
    ...entry,
    artist: normalizeArtistList(entry.artist),
    album_artist: normalizeArtistList(entry.album_artist),
  }
}

function parseImportEntries(fileContent, fileType) {
  let entries = []
  if (fileType === 'm3u' || fileType === 'm3u8') entries = parseM3U(fileContent)
  else if (fileType === 'csv') entries = parseCSV(fileContent)
  else if (fileType === 'json') entries = parseJSON(fileContent)
  else if (fileType === 'txt') entries = require('../../electron/playlists/textList').parseTextList(fileContent)
  return entries.map(normalizeImportEntry)
}

function collectImportEntries(payload = {}) {
  const files = Array.isArray(payload.files) && payload.files.length
    ? payload.files
    : [{ fileContent: payload.fileContent || '', fileType: payload.fileType || 'csv', fileName: payload.fileName || '' }]

  const entries = []
  const fileSummaries = []
  for (const file of files) {
    const fileType = file?.fileType || 'csv'
    const parsed = parseImportEntries(file?.fileContent || '', fileType)
    fileSummaries.push({
      fileName: file?.fileName || '',
      fileType,
      total: parsed.length,
    })
    entries.push(...parsed)
  }

  return {
    entries,
    fileCount: files.filter(file => file?.fileContent || file?.fileName).length,
    fileSummaries,
  }
}

function normalizeMatchValue(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring|remaster(?:ed)?|deluxe|radio edit|explicit|clean|version|mix)\b/gi, ' ')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function findTrack(db, entry) {
  let track = null
  // Same ISRC: the same recording, whatever the names say.
  const isrc = normalizeIsrc(entry.isrc || entry.ISRC)
  if (isrc) {
    track = db.prepare("SELECT id FROM tracks WHERE isrc = ? AND file_path NOT LIKE 'ghost://%' LIMIT 1").get(isrc)
    if (track) return track
  }
  const normalizedArtist = normalizeArtistList(entry.artist)
  const primaryArtist = String(normalizedArtist || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)[0] || null
  if (entry.file_path) {
    track = db.prepare("SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND file_path = ?").get(entry.file_path)
    if (!track) {
      const filename = entry.file_path.split(/[/\\]/).pop().replace(/\.[^.]+$/, '').toLowerCase()
      track = db.prepare("SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(title) = ? LIMIT 1").get(filename)
    }
  }
  if (!track && entry.title && normalizedArtist) {
    track = db.prepare("SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(title) = ? AND LOWER(artist) = ? LIMIT 1").get(entry.title.toLowerCase(), normalizedArtist.toLowerCase())
  }
  if (!track && entry.title && primaryArtist) {
    track = db.prepare("SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(title) = ? AND (LOWER(artist) = ? OR LOWER(artist) LIKE ?) LIMIT 1").get(entry.title.toLowerCase(), primaryArtist.toLowerCase(), `%${primaryArtist.toLowerCase()}%`)
  }
  if (!track && entry.title && !normalizedArtist) {
    track = db.prepare("SELECT id FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(title) = ? LIMIT 1").get(entry.title.toLowerCase())
  }
  if (!track && entry.title && normalizedArtist) {
    const titleNorm = normalizeMatchValue(entry.title)
    const artistNorm = normalizeMatchValue(normalizedArtist)
    const candidates = db.prepare("SELECT id, title, artist FROM tracks WHERE file_path NOT LIKE 'ghost://%' AND LOWER(title) LIKE ? LIMIT 50").all(`%${entry.title.toLowerCase().slice(0, 18)}%`)
    let best = null
    let bestScore = 0
    for (const candidate of candidates) {
      const candidateTitle = normalizeMatchValue(candidate.title)
      const candidateArtist = normalizeMatchValue(candidate.artist)
      let score = 0
      if (candidateTitle === titleNorm) score += 70
      else if (candidateTitle.includes(titleNorm) || titleNorm.includes(candidateTitle)) score += 45
      if (candidateArtist === artistNorm) score += 30
      else if (candidateArtist.includes(artistNorm) || artistNorm.includes(candidateArtist)) score += 18
      if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }
    if (best && bestScore >= 72) track = { id: best.id }
  }
  return track
}

function queuePendingImportedMetadata(db, entry = {}, sourcePlatform = 'generic') {
  const title = String(entry.title || '').trim()
  if (!title) return null
  db.prepare(`
    INSERT INTO pending_import_metadata (
      id, title, normalized_title, artist, normalized_artist, album, normalized_album,
      year, genre, genres, record_label, explicit, danceability, energy, track_key, loudness,
      mode, speechiness, acousticness, instrumentalness, liveness, valence, tempo, time_signature,
      duration, source_url, source_platform, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `pim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    normalizeMatchValue(title),
    normalizeArtistList(entry.artist) || null,
    normalizeMatchValue(normalizeArtistList(entry.artist)),
    entry.album || null,
    normalizeMatchValue(entry.album),
    entry.year ?? null,
    entry.genre || firstGenre(entry.genres),
    entry.genres || null,
    entry.record_label || null,
    entry.explicit === undefined || entry.explicit === null || entry.explicit === '' ? null : (entry.explicit ? 1 : 0),
    entry.danceability ?? null,
    entry.energy ?? null,
    entry.track_key ?? null,
    entry.loudness ?? null,
    entry.mode ?? null,
    entry.speechiness ?? null,
    entry.acousticness ?? null,
    entry.instrumentalness ?? null,
    entry.liveness ?? null,
    entry.valence ?? null,
    entry.tempo ?? null,
    entry.time_signature ?? null,
    entry.duration ?? null,
    entry.source_url || null,
    sourcePlatform || 'generic',
    Date.now()
  )
  return true
}

function createGhostTrack(db, entry, sourcePlatform = 'generic', playlistId = 'import') {
  const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const safePlatform = String(sourcePlatform || 'generic').toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'generic'
  const title = String(entry.title || 'Unknown Track').trim() || 'Unknown Track'
  const artist = normalizeArtistList(entry.artist) || 'Unknown Artist'
  const filePath = `ghost://${safePlatform}/${playlistId}/${id}`
  db.prepare(`
    INSERT INTO tracks
    (id, file_path, file_hash, title, artist, album, album_artist, track_num, year, genre, genres, record_label, explicit, danceability, energy, track_key, loudness, mode, speechiness, acousticness, instrumentalness, liveness, valence, tempo, time_signature, duration, artwork_path, bitrate, last_modified, source_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    filePath,
    id,
    title,
    artist,
    entry.album || null,
    normalizeArtistList(entry.artist) || null,
    null,
    entry.year || null,
    entry.genre || null,
    entry.genres || null,
    entry.record_label || null,
    entry.explicit ? 1 : 0,
    entry.danceability ?? null,
    entry.energy ?? null,
    entry.track_key ?? null,
    entry.loudness ?? null,
    entry.mode ?? null,
    entry.speechiness ?? null,
    entry.acousticness ?? null,
    entry.instrumentalness ?? null,
    entry.liveness ?? null,
    entry.valence ?? null,
    entry.tempo ?? null,
    entry.time_signature ?? null,
    entry.duration ? Number(entry.duration) : null,
    null,
    null,
    Date.now(),
    // Kept on the track, so a ghost with a YouTube link can be streamed.
    entry.source_url ? String(entry.source_url).slice(0, 1000) : null
  )
  // Kept so the file is matched to this ghost by ISRC when it arrives.
  const ghostIsrc = normalizeIsrc(entry.isrc || entry.ISRC)
  if (ghostIsrc) db.prepare('UPDATE tracks SET isrc = ? WHERE id = ?').run(ghostIsrc, id)
  return { id, title, artist, album: entry.album || null, file_path: filePath, source_url: entry.source_url || null, isGhost: true }
}

function applyImportedMetadata(db, trackId, entry = {}) {
  const track = db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
  if (!track) return null
  const genre = entry.genre || firstGenre(entry.genres)
  const genres = entry.genres || null
  const explicitValue = entry.explicit ? 1 : 0
  db.prepare(`
    UPDATE tracks SET
      year = COALESCE(?, year),
      genre = COALESCE(NULLIF(?, ''), genre),
      genres = COALESCE(NULLIF(?, ''), genres),
      record_label = COALESCE(NULLIF(?, ''), record_label),
      explicit = CASE WHEN ? IS NULL THEN explicit ELSE ? END,
      danceability = COALESCE(?, danceability),
      energy = COALESCE(?, energy),
      track_key = COALESCE(?, track_key),
      loudness = COALESCE(?, loudness),
      mode = COALESCE(?, mode),
      speechiness = COALESCE(?, speechiness),
      acousticness = COALESCE(?, acousticness),
      instrumentalness = COALESCE(?, instrumentalness),
      liveness = COALESCE(?, liveness),
      valence = COALESCE(?, valence),
      tempo = COALESCE(?, tempo),
      time_signature = COALESCE(?, time_signature)
    WHERE id = ?
  `).run(
    entry.year ?? null,
    genre,
    genres,
    entry.record_label || null,
    entry.explicit === undefined || entry.explicit === null || entry.explicit === '' ? null : explicitValue,
    entry.explicit === undefined || entry.explicit === null || entry.explicit === '' ? null : explicitValue,
    entry.danceability ?? null,
    entry.energy ?? null,
    entry.track_key ?? null,
    entry.loudness ?? null,
    entry.mode ?? null,
    entry.speechiness ?? null,
    entry.acousticness ?? null,
    entry.instrumentalness ?? null,
    entry.liveness ?? null,
    entry.valence ?? null,
    entry.tempo ?? null,
    entry.time_signature ?? null,
    trackId
  )
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(trackId)
}

function buildImportPreview(db, entries = []) {
  const rows = []
  let matched = 0
  for (const entry of entries) {
    const track = findTrack(db, entry)
    if (track) matched++
    rows.push({
      title: entry.title || path.basename(entry.file_path || '').replace(/\.[^.]+$/, '') || 'Unknown Track',
      artist: entry.artist || 'Unknown Artist',
      album: entry.album || null,
      status: track ? 'Matched' : 'Ghost Song',
      action: track ? 'Already in library' : 'Try auto-match, download, or pick a local file',
    })
  }
  return { total: entries.length, matched, ghostable: Math.max(entries.length - matched, 0), rows: rows.slice(0, 12) }
}

function resolveGhostTrack(db, ghostTrackId, targetTrackId, sourceIdentity = null, options = {}) {
  const ghost = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path LIKE 'ghost://%'").get(ghostTrackId)
  const target = db.prepare("SELECT * FROM tracks WHERE id = ? AND file_path NOT LIKE 'ghost://%'").get(targetTrackId)
  if (!target) return { error: 'Target track not found' }
  if (!ghost) {
    // A rescan or a previous successful attempt may already have resolved it.
    const alias = db.prepare('SELECT track_id FROM track_aliases WHERE old_id = ?').get(ghostTrackId)
    return alias?.track_id === targetTrackId ? { ok: true, track: target } : { error: 'Ghost track not found' }
  }
  if (sourceIdentity) {
    const { sourceIdentity: identityOf } = require('../../electron/online/sources')
    const ghostSourceIdentity = identityOf(ghost.source_url)
    if (!ghostSourceIdentity || ghostSourceIdentity !== sourceIdentity) return { ok: false, skipped: true, error: 'Ghost track source does not match downloaded source' }
  }

  // Mass playlist downloads must never turn a wrong provider match into a
  // library file carrying the ghost's metadata. The indexed file has to agree
  // with the requested title/artist first; otherwise leave the ghost unresolved.
  if (options.requireMetadataMatch) {
    const wantedTitle = normalizeMatchValue(ghost.title)
    const wantedArtist = normalizeMatchValue(ghost.artist)
    const actualTitle = normalizeMatchValue(target.title)
    const actualArtist = normalizeMatchValue(target.artist)
    const wantedDuration = Number(ghost.duration) || 0
    const actualDuration = Number(target.duration) || 0
    const durationMatches = options.allowDurationMismatch === true || !(wantedDuration > 0 && actualDuration > 0) || Math.abs(wantedDuration - actualDuration) <= 10
    if (!wantedTitle || !wantedArtist || !actualTitle || !actualArtist ||
        wantedTitle !== actualTitle || wantedArtist !== actualArtist || !durationMatches) {
      return {
        ok: false,
        skipped: true,
        error: 'Downloaded file metadata does not match "' + (ghost.title || 'the requested song') + '" by ' + (ghost.artist || 'the requested artist'),
      }
    }
  }

  const run = db.transaction(() => {
    applyImportedMetadata(db, targetTrackId, ghost)

    if (options.dedupePlaylist) {
      // Resolving several ghost rows can legitimately find the same library
      // track. Do not turn that into repeated entries in one playlist.
      const ghostRows = db.prepare('SELECT id, playlist_id FROM playlist_tracks WHERE track_id = ?').all(ghostTrackId)
      const existing = db.prepare('SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND track_id = ? AND id <> ? LIMIT 1')
      const update = db.prepare('UPDATE playlist_tracks SET track_id = ? WHERE id = ?')
      const remove = db.prepare('DELETE FROM playlist_tracks WHERE id = ?')
      for (const row of ghostRows) {
        if (existing.get(row.playlist_id, targetTrackId, row.id)) remove.run(row.id)
        else update.run(targetTrackId, row.id)
      }
    } else {
      db.prepare('UPDATE playlist_tracks SET track_id = ? WHERE track_id = ?').run(targetTrackId, ghostTrackId)
    }

    // A streamed ghost can have been liked and played: keep that on the file.
    db.prepare('UPDATE OR IGNORE user_likes SET track_id = ? WHERE track_id = ?').run(targetTrackId, ghostTrackId)
    db.prepare('UPDATE OR IGNORE play_history SET track_id = ? WHERE track_id = ?').run(targetTrackId, ghostTrackId)
    db.prepare('DELETE FROM user_likes WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM play_history WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM lyrics_cache WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM lyrics_translations WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM artist_track_links WHERE track_id = ?').run(ghostTrackId)
    db.prepare('DELETE FROM tracks WHERE id = ?').run(ghostTrackId)
    // A player or page still holding the old id finds the file through it.
    try { db.prepare('INSERT OR REPLACE INTO track_aliases (old_id, track_id) VALUES (?, ?)').run(ghostTrackId, targetTrackId) } catch {}
  })

  run()
  return { ok: true, track: db.prepare('SELECT * FROM tracks WHERE id = ?').get(targetTrackId) }
}

function importExternalMetadata(db, payload = {}) {
  const { sourcePlatform = 'generic' } = payload || {}
  const { entries, fileCount } = collectImportEntries(payload)
  let matched = 0
  let savedForLater = 0
  const unmatched = []
  for (const entry of entries) {
    const track = findTrack(db, entry)
    if (!track) {
      queuePendingImportedMetadata(db, entry, sourcePlatform)
      savedForLater++
      unmatched.push({
        title: entry.title || 'Unknown Track',
        artist: entry.artist || 'Unknown Artist',
        album: entry.album || null,
      })
      continue
    }
    applyImportedMetadata(db, track.id, { ...entry, sourcePlatform })
    matched++
  }
  return {
    ok: true,
    fileCount,
    total: entries.length,
    matched,
    skipped: Math.max(entries.length - matched, 0),
    savedForLater,
    unmatched: unmatched.slice(0, 50),
  }
}

async function writePlaylistCover(playlistId, imageData) {
  if (!imageData) return null
  const base64 = String(imageData).split(',')[1] || ''
  const mime = String(imageData).match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/i)?.[1] || 'image/jpeg'
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg'
  const coverPath = path.join(getStorageDir(), 'artwork', `playlist-${playlistId}.${ext}`)
  await fs.writeFile(coverPath, Buffer.from(base64, 'base64'))
  return coverPath
}

// Regular playlists are M3U8 files in the music folder (electron/playlistFiles.js);
// the database holds a copy. Smart playlists live only in the database.
const playlistFiles = () => require('../../electron/playlistFiles')
const fileCall = (res, fn) => {
  try { res.json(fn() || { ok: true }) } catch (e) { res.status(400).json({ error: e.message }) }
}
const isFilePlaylist = id => id === 'liked' || !!getDB().prepare('SELECT file_name FROM playlists WHERE id = ?').get(id)?.file_name

router.get('/', (req, res) => {
  const uid = req.query.userId || 'guest'
  res.json(getDB().prepare('SELECT p.*, (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count FROM playlists p WHERE p.user_id = ? OR p.file_name IS NOT NULL ORDER BY p.name COLLATE NOCASE').all(uid))
})

router.get('/favorites-enabled', (req, res) => res.json(playlistFiles().favoritesEnabled()))

router.post('/', (req, res) => fileCall(res, () => playlistFiles().create(req.body?.name, { trackIds: req.body?.trackIds || [] })))

router.post('/smart', (req, res) => {
  const db = getDB()
  const id = 'pl-' + Date.now()
  db.prepare('INSERT INTO playlists (id, name, user_id, smart_rules) VALUES (?, ?, ?, ?)').run(id, String(req.body?.name || '').trim() || 'Smart playlist', req.body?.userId || 'guest', JSON.stringify({ match: 'all', rules: [] }))
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(id))
})

router.put('/:id', async (req, res) => {
  const db = getDB()
  const playlist = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id)
  if (req.params.id !== 'liked' && !playlist) return res.status(404).json({ error: 'Playlist not found' })
  const { name, description, clearCover, smartRules, coverData } = req.body || {}
  if (isFilePlaylist(req.params.id)) {
    return fileCall(res, () => {
      if (name !== undefined) playlistFiles().rename(req.params.id, name)
      if (coverData) playlistFiles().setCover(req.params.id, coverData)
      if (clearCover) playlistFiles().setCover(req.params.id, null)
      return db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id)
    })
  }
  if (name !== undefined) db.prepare('UPDATE playlists SET name = ? WHERE id = ?').run(name, req.params.id)
  if (description !== undefined) db.prepare('UPDATE playlists SET description = ? WHERE id = ?').run(description, req.params.id)
  if (smartRules !== undefined && smartRules !== null) {
    const rules = normalizeRules(smartRules)
    db.prepare('UPDATE playlists SET smart_rules = ? WHERE id = ?').run(JSON.stringify(rules || { match: 'all', rules: [] }), req.params.id)
  }
  if (coverData) {
    if (playlist.cover_path && fs.existsSync(playlist.cover_path)) {
      try { fs.removeSync(playlist.cover_path) } catch {}
    }
    const coverPath = await writePlaylistCover(req.params.id, coverData)
    db.prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(coverPath, req.params.id)
  }
  if (clearCover) {
    if (playlist.cover_path && fs.existsSync(playlist.cover_path)) {
      try { fs.removeSync(playlist.cover_path) } catch {}
    }
    db.prepare('UPDATE playlists SET cover_path = ? WHERE id = ?').run(null, req.params.id)
  }
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id))
})

router.get('/:id/cover', (req, res) => {
  const playlist = getDB().prepare('SELECT cover_path FROM playlists WHERE id = ?').get(req.params.id)
  if (!playlist?.cover_path || !fs.existsSync(playlist.cover_path)) return res.status(404).end()
  res.sendFile(path.resolve(playlist.cover_path))
})

router.post('/external-import-metadata', (req, res) => {
  try {
    res.json(importExternalMetadata(getDB(), req.body || {}))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/resolve-ghost', (req, res) => {
  try {
    res.json(resolveGhostTrack(getDB(), req.body.ghostTrackId, req.body.targetTrackId, null, req.body?.options || {}))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

router.post('/smart-preview', (req, res) => {
  try { res.json(smartPreview(getDB(), req.body?.rules, req.body?.userId)) } catch (e) { res.status(400).json({ error: e.message }) }
})

router.get('/:id/tracks', (req, res) => {
  const db = getDB()
  if (req.params.id === 'liked') return res.json(db.prepare("SELECT t.*, ul.liked_at AS playlist_track_id FROM tracks t JOIN user_likes ul ON ul.track_id = t.id WHERE ul.user_id = 'guest' ORDER BY ul.liked_at DESC").all())
  const playlist = db.prepare('SELECT user_id, smart_rules FROM playlists WHERE id = ?').get(req.params.id)
  if (playlistRules(playlist)) return res.json(smartTracks(db, playlist.smart_rules, playlist.user_id))
  res.json(db.prepare(`
    SELECT t.*, pt.position AS playlist_track_id, pt.added_by, pt.added_at FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `).all(req.params.id))
})

router.post('/:id/tracks', (req, res) => fileCall(res, () => playlistFiles().addTracks(req.params.id, req.body?.trackIds || [req.body?.trackId].filter(Boolean))))
router.post('/:id/tracks/remove', (req, res) => fileCall(res, () => playlistFiles().removeTracks(req.params.id, req.body?.trackIds || [])))

router.put('/:id/reorder', (req, res) => {
  if (!Array.isArray(req.body?.trackIds)) return res.status(400).json({ error: 'trackIds must be an array' })
  fileCall(res, () => playlistFiles().reorder(req.params.id, req.body.trackIds))
})

router.post('/:id/deduplicate', (req, res) => fileCall(res, () => playlistFiles().deduplicate(req.params.id)))

router.delete('/:id', (req, res) => {
  const db = getDB()
  const playlist = db.prepare('SELECT cover_path, file_name FROM playlists WHERE id = ?').get(req.params.id)
  if (playlist?.file_name) return fileCall(res, () => playlistFiles().remove(req.params.id))
  db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?').run(req.params.id)
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id)
  if (playlist?.cover_path && fs.existsSync(playlist.cover_path)) {
    try { fs.removeSync(playlist.cover_path) } catch {}
  }
  res.json({ ok: true })
})

// Also used by the download manager: a streamed song saved to the library
// replaces its ghost track once the file is indexed.
router.resolveGhostTrack = resolveGhostTrack

module.exports = router
