// A search typed the wrong way round: on the other keyboard layout ("ифыы
// игьзшт" for "bass bumpin"), or in the other alphabet as it sounds ("басс
// бампин", "тайни фолдэбл ситис"). Pure functions; librarySearch.js uses them
// to find the library's own words for such a query.
//
// The Android app has the same rules (Phonetic.kt): keep the two in step.

const EN_KEYS = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`"
const RU_KEYS = 'йцукенгшщзхъфывапролджэячсмитьбюё'
const TO_RU = new Map([...EN_KEYS].map((key, i) => [key, RU_KEYS[i]]))
const TO_EN = new Map([...RU_KEYS].map((key, i) => [key, EN_KEYS[i]]))

const CYRILLIC = /\p{Script=Cyrillic}/u
const LATIN = /\p{Script=Latin}/u

/**
 * `text` as the same keys type it on the other layout: "ифыы" -> "bass",
 * "rbyj" -> "кино" (to Latin when it's mostly Cyrillic). null when no key changes.
 */
function swapLayout(text) {
  const chars = [...String(text || '').toLowerCase()]
  const cyrillic = chars.filter(c => CYRILLIC.test(c)).length
  const latin = chars.filter(c => LATIN.test(c)).length
  if (!cyrillic && !latin) return null
  const keys = cyrillic > latin ? TO_EN : TO_RU
  const swapped = chars.map(c => keys.get(c) ?? c).join('')
  return swapped === chars.join('') ? null : swapped
}

const RU_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}

/** Cyrillic written in Latin letters: "фолдэбл" -> "foldebl". Latin stays as it is. */
function translit(word) {
  return [...String(word || '').toLowerCase()].map(c => RU_LATIN[c] ?? c).join('')
}

// English spellings and their Russian-sounding ones, brought to the same
// letters. In order: "tch" before "ch", "dzh" before "zh". Capitals are sounds
// of their own (C: ch, X: sh, J: j). A "w" after a vowel is one ("show", "шоу").
const SOUNDS = [
  [/^kn/, 'n'], [/^wr/, 'r'], [/^gh/, 'g'], [/^x/, 's'],
  [/tch/g, 'C'], [/sch|sh/g, 'X'], [/ch/g, 'C'], [/dzh|dj|zh|j/g, 'J'],
  [/ph/g, 'f'], [/kh/g, 'h'], [/ck/g, 'k'], [/qu/g, 'kv'], [/q/g, 'k'], [/x/g, 'ks'],
  [/(?<=[aeiou])w(?![aeiouy])/g, ''], [/wh|w/g, 'v'], [/th/g, 't'], [/gh/g, ''], [/c(?=[eiy])/g, 's'], [/c/g, 'k'], [/z/g, 's'], [/mb$/, 'm'],
]

/**
 * How a word sounds, in its consonants: "Cities" and "ситис" are both "sts",
 * "Tiny" and "тайни" "tn". A word starting with a vowel starts with "a".
 */
function skeleton(word) {
  let text = translit(word).replace(/[^a-z]/g, '')
  for (const [pattern, sound] of SOUNDS) text = text.replace(pattern, sound)
  const start = /^[aeiouy]/.test(text) ? 'a' : ''
  return (start + text.replace(/[aeiouy]/g, '')).replace(/(.)\1+/g, '$1')
}

module.exports = { swapLayout, translit, skeleton }
