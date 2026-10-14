import { translate } from './i18n'

// "1 track", "2 tracks": a count with its word, singular for one. Translated:
// the phrase is "{n} track|{n} tracks" (Russian: three forms, see i18n.jsx).
export function plural(count, word, many = `${word}s`) {
  const n = Number(count) || 0
  return translate(`{n} ${word}|{n} ${many}`, { n: n.toLocaleString(), count: n })
}
