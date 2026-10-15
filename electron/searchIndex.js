// The library's search index (SQLite FTS5): a song's title, artist, album,
// album artist, comment tag and the lyrics in its file, so the search bar
// finds a song by any of them.
//
// - The tokenizer folds case and accents for every alphabet ("кино" finds
//   "Кино", "beyonce" finds "Beyoncé"), which LIKE only does for A-Z. "ё" is
//   written as "е" and apostrophes are dropped ("dont" finds "Don't"), on both
//   sides: in what's indexed (FOLD_SQL) and in what's searched (fold).
// - Triggers on `tracks` keep the index current whatever code changes a song,
//   so only the lyrics need saving by hand (setFileLyrics): they come from the
//   file and aren't in `tracks`. `track_search_docs` gives each song a lasting
//   index row number (tracks' own rowid can change on VACUUM) and holds those
//   lyrics: NULL while unread, '' when the file has none.
// - Streamed (ghost) songs aren't indexed: search is for the library.

// 2: the triggers no longer use INSERT OR IGNORE (see addDoc).
const VERSION = '2'
const NAME_COLUMNS = ['title', 'artist', 'album', 'album_artist']
const COLUMNS = [...NAME_COLUMNS, 'comment', 'lyrics']

/** "Ёлка — Don't" -> "Елка — Dont": what the tokenizer doesn't fold itself. */
function fold(text) {
  return String(text ?? '').normalize('NFC').replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/['’`]/g, '')
}
const foldSql = expr => `replace(replace(replace(replace(replace(IFNULL(${expr}, ''), 'ё', 'е'), 'Ё', 'Е'), '''', ''), '’', ''), '\`', '')`

// LRC time stamps and [ar:...] lines aren't words anyone searches for.
function lyricsText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter(line => !/^\s*\[[a-z]+:[^\]]*\]\s*$/i.test(line))
    .map(line => line.replace(/\[\d+:\d{2}(?:[.:]\d{1,3})?\]|<\d+:\d{2}(?:[.:]\d{1,3})?>/g, '').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\0/g, '')
}

// A song's index row number, made once. Not INSERT OR IGNORE: inside a
// trigger SQLite replaces that OR IGNORE with the outer statement's conflict
// policy, so an UPSERT on tracks (saving search results, an online song
// played again) failed on the existing row and saved nothing.
const addDoc = id => `INSERT INTO track_search_docs (track_id) SELECT ${id} WHERE NOT EXISTS (SELECT 1 FROM track_search_docs WHERE track_id = ${id});`

const docOf = id => `(SELECT doc FROM track_search_docs WHERE track_id = ${id})`
const indexRow = id => `
  DELETE FROM track_search WHERE rowid = ${docOf(id)};
  INSERT INTO track_search (rowid, ${COLUMNS.join(', ')})
    SELECT d.doc, ${NAME_COLUMNS.map(c => foldSql(`t.${c}`)).join(', ')}, ${foldSql('t.comment')}, ${foldSql('d.lyrics')}
    FROM tracks t JOIN track_search_docs d ON d.track_id = t.id
    WHERE t.id = ${id} AND t.file_path NOT LIKE 'ghost://%';`

/** Creates the index (filled from the library the first time), and its triggers. */
function ensureSearchIndex(db) {
  const version = (() => { try { return db.prepare("SELECT value FROM settings WHERE key = 'search_index_version'").get()?.value } catch { return null } })()
  // One SQL script, not db.transaction: the tests' node:sqlite has none.
  if (version !== VERSION) {
    try {
      db.exec(`
      SAVEPOINT search_index;
      DROP TABLE IF EXISTS track_search;
      DROP TRIGGER IF EXISTS track_search_insert;
      DROP TRIGGER IF EXISTS track_search_update;
      DROP TRIGGER IF EXISTS track_search_delete;
      CREATE TABLE IF NOT EXISTS track_search_docs (doc INTEGER PRIMARY KEY, track_id TEXT UNIQUE NOT NULL, lyrics TEXT);
      CREATE VIRTUAL TABLE track_search USING fts5(${COLUMNS.join(', ')}, tokenize = "unicode61 remove_diacritics 2", prefix = '2 3');
      INSERT OR IGNORE INTO track_search_docs (track_id) SELECT id FROM tracks;
      INSERT INTO track_search (rowid, ${COLUMNS.join(', ')})
        SELECT d.doc, ${NAME_COLUMNS.map(c => foldSql(`t.${c}`)).join(', ')}, ${foldSql('t.comment')}, ${foldSql('d.lyrics')}
        FROM tracks t JOIN track_search_docs d ON d.track_id = t.id
        WHERE t.file_path NOT LIKE 'ghost://%';
      INSERT OR REPLACE INTO settings (key, value) VALUES ('search_index_version', '${VERSION}');
      RELEASE search_index;
    `)
    } catch (e) {
      try { db.exec('ROLLBACK TO search_index; RELEASE search_index') } catch {}
      throw e
    }
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS track_search_insert AFTER INSERT ON tracks BEGIN
      ${addDoc('new.id')}
      ${indexRow('new.id')}
    END;
    CREATE TRIGGER IF NOT EXISTS track_search_update AFTER UPDATE OF id, title, artist, album, album_artist, comment, file_path ON tracks BEGIN
      DELETE FROM track_search WHERE rowid = ${docOf('old.id')};
      ${addDoc('new.id')}
      ${indexRow('new.id')}
    END;
    CREATE TRIGGER IF NOT EXISTS track_search_delete AFTER DELETE ON tracks BEGIN
      DELETE FROM track_search WHERE rowid = ${docOf('old.id')};
      DELETE FROM track_search_docs WHERE track_id = old.id;
    END;
  `)
}

/** Saves the lyrics read from a song's file ('' when it has none) into the index. */
function setFileLyrics(db, trackId, text) {
  if (!trackId) return
  const id = `'${String(trackId).replace(/'/g, "''")}'`
  const lyrics = `'${lyricsText(text).replace(/'/g, "''")}'`
  try {
    db.exec(`SAVEPOINT search_lyrics;
      INSERT INTO track_search_docs (track_id, lyrics) VALUES (${id}, ${lyrics}) ON CONFLICT(track_id) DO UPDATE SET lyrics = excluded.lyrics;
      ${indexRow(id)}
      RELEASE search_lyrics;`)
  } catch (e) {
    try { db.exec('ROLLBACK TO search_lyrics; RELEASE search_lyrics') } catch {}
    console.warn('[searchIndex] Could not index lyrics:', e.message)
  }
}

// Words as the tokenizer splits them: "AC/DC" -> ac, dc.
const WORD = /[\p{L}\p{N}]+/gu
const MAX_WORDS = 8

/** The query's words, folded: "Don't  Ёлка" -> ['dont', 'елка']. */
function queryWords(query) {
  return [...new Set(fold(query).toLowerCase().match(WORD) || [])].slice(0, MAX_WORDS)
}

/**
 * An FTS5 MATCH for `query`: every word (as the start of a word) in one of
 * `columns`, in any order. null for a query with no words.
 */
function matchExpression(query, columns = COLUMNS) {
  const words = queryWords(query)
  if (!words.length) return null
  const all = words.map(word => `"${word}"*`).join(' ')
  return columns.length === COLUMNS.length ? all : `{${columns.join(' ')}} : (${all})`
}

module.exports = { ensureSearchIndex, setFileLyrics, matchExpression, queryWords, fold, lyricsText, COLUMNS, NAME_COLUMNS }
