// The quick player's words (it doesn't load the app's i18n, which needs its
// API): English, and Russian when the app is set to it (?lang=).

const RU = {
  'Pin on top': 'Поверх всех окон',
  'Unpin': 'Открепить',
  'Minimize': 'Свернуть',
  'Close': 'Закрыть',
  'Play': 'Играть',
  'Pause': 'Пауза',
  'Previous file in the folder': 'Предыдущий файл в папке',
  'Next file in the folder': 'Следующий файл в папке',
  'Volume': 'Громкость',
  'Mute': 'Без звука',
  'Unmute': 'Включить звук',
  'Artist': 'Артист',
  'Album': 'Альбом',
  'Album artist': 'Исп. альбома',
  'Year': 'Год',
  'Genre': 'Жанр',
  'Label': 'Лейбл',
  'Track': 'Трек',
  'Disc': 'Диск',
  'Composer': 'Композитор',
  'BPM': 'BPM',
  'Key': 'Тональность',
  'Comment': 'Комментарий',
  'Format': 'Формат',
  'Bitrate': 'Битрейт',
  'Sample rate': 'Частота',
  'Bit depth': 'Разрядность',
  'Channels': 'Каналы',
  'Length': 'Длительность',
  'Size': 'Размер',
  'File': 'Файл',
  'Folder': 'Папка',
  'Show in folder': 'Показать в папке',
  '{n} kbps': '{n} кбит/с',
  '{n} kHz': '{n} кГц',
  '{n}-bit': '{n} бит',
  'lossless': 'без потерь',
  'Mono': 'Моно',
  'Stereo': 'Стерео',
  '{n} of {total}': '{n} из {total}',
  'Seeking: normal': 'Перемотка: обычная',
  'Seeking: {step} a pixel': 'Перемотка: {step} на пиксель',
  '{n} s': '{n} с',
  '{n} ms': '{n} мс',
  'Drag to seek; move the mouse up from the bar while dragging to seek slower and finer, down to 1 ms a pixel (Shift: 1 ms a pixel at once)': 'Тяните, чтобы перемотать; уведите мышь вверх от полосы во время перетаскивания — перемотка пойдёт медленнее и точнее, вплоть до 1 мс на пиксель (Shift — сразу 1 мс на пиксель)',
  'Mouse wheel over the player: a second on or back; with Shift, a millisecond': 'Колесо мыши над плеером: на секунду вперёд или назад; с Shift — на миллисекунду',
  'Converting for playback…': 'Перекодирую для воспроизведения…',
  "This format plays through ffmpeg, and it wasn't found. Download it in Lokal: Settings → External Tools.": 'Этот формат играется через ffmpeg, а он не найден. Скачать его можно в Lokal: Настройки → Внешние инструменты.',
  "This file couldn't be played, even after conversion.": 'Этот файл не получилось воспроизвести даже после перекодирования.',
  "The file isn't there any more.": 'Файла больше нет на месте.',
  "Couldn't read the tags": 'Не удалось прочитать теги',
}

const params = new URLSearchParams(window.location.search)
const language = params.get('lang') === 'ru' ? 'ru' : 'en'
document.documentElement.lang = language

/** The phrase in the app's language, {name}s filled in. */
export function t(phrase, vars) {
  const text = (language === 'ru' && RU[phrase]) || phrase
  return vars ? text.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : text
}

export const startFile = params.get('file') || ''
