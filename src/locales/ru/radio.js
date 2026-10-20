// Russian phrases for online radio (the Online Radio tab, its settings, the
// player while a station plays), keyed by the English phrase.
export default {
  'Online Radio': 'Онлайн-радио',
  'On air': 'Эфир',
  'Live from the web': 'Прямой эфир из интернета',
  'Online radio: {station}': 'Онлайн-радио: {station}',
  '“{title}” isn\'t playing: {message}': '«{title}» не играет: {message}',
  'The station stopped responding.': 'Станция перестала отвечать.',
  '{n} station|{n} stations': ['{n} станция', '{n} станции', '{n} станций'],
  'Loaded: {n} station|Loaded: {n} stations': ['Загружено: {n} станция', 'Загружено: {n} станции', 'Загружено: {n} станций'],
  'Give the link to your station catalogue: a JSON file listing your stations. It\'s downloaded once and kept; you can change the link or update it any time in Settings > Online Radio.':
    'Укажите ссылку на каталог станций — JSON-файл со списком ваших радиостанций. Он скачивается один раз и сохраняется; ссылку можно заменить или обновить каталог в любой момент в Настройки > Онлайн-радио.',

  // Station list
  'Station': 'Станция',
  'Now playing': 'Сейчас играет',
  'Stream': 'Поток',
  'Icon': 'Иконка',
  'Open config': 'Открыть конфиг',
  'Copy stream link': 'Копировать ссылку на поток',
  'Open station history': 'Открыть историю радиостанции',
  'Edit station list columns': 'Настроить колонки списка станций',
  'Station list columns': 'Колонки списка станций',
  'Show in the station list': 'Показывать в списке станций',
  'Saved for the station list in this profile. Drag a column\'s edge in the header to resize it. Stations keep the catalogue\'s order.':
    'Сохраняется для списка станций в этом профиле. Ширину колонки можно менять, потянув её край в заголовке. Станции всегда идут в порядке каталога.',

  // Catalogue
  'Station catalogue link': 'Ссылка на каталог станций',
  'Load': 'Загрузить',
  'Download the catalogue again': 'Скачать каталог заново',
  'What the catalogue file looks like': 'Как должен выглядеть файл каталога',
  'required: the station\'s name': 'обязательно: название станции',
  'required: the stream\'s address (http or https)': 'обязательно: адрес потока (http или https)',
  'optional: shown in the Genre column': 'необязательно: показывается в колонке «Жанр»',
  'optional: shown in the Comment column (a link opens in the browser)': 'необязательно: показывается в колонке «Комментарий» (ссылка открывается в браузере)',
  'optional: a link to the station\'s played-songs history, shown in the Online history column and in the station\'s menu': 'необязательно: ссылка на историю эфира станции — показывается в колонке «Онлайн-история» и в меню станции',
  'optional: a picture, shown in the list and as the cover until a song\'s own is found': 'необязательно: картинка — в списке и как обложка, пока не найдена обложка трека',
  'optional: the station\'s own "now playing" service, for covers, album and lyrics: azuracast (url), radiorecord (station), lautfm (station), or json (url and where each field is: artist, title or text, cover, album, lyrics, duration)':
    'необязательно: собственный сервис станции «сейчас играет» — для обложек, альбома и текстов: azuracast (url), radiorecord (station), lautfm (station) или json (url и где лежит каждое поле: artist, title или text, cover, album, lyrics, duration)',
  'The stations are listed in the order of the file. Only the data is kept, not the file: "Update" downloads it again.':
    'Станции показываются в том же порядке, что и в файле. Сохраняются только данные, а не сам файл: «Обновить» скачивает его заново.',
  'The station catalogue couldn\'t be loaded': 'Не удалось загрузить каталог станций',
  'Nothing was changed: the stations already loaded stay as they were. Fix the file and try again.':
    'Ничего не изменилось: уже загруженные станции остались прежними. Исправьте файл и попробуйте снова.',
  'The file isn\'t valid JSON (line {line}, column {column}): {detail}': 'Файл не является корректным JSON (строка {line}, столбец {column}): {detail}',
  'The file isn\'t valid JSON: {detail}': 'Файл не является корректным JSON: {detail}',
  'The file is empty.': 'Файл пустой.',
  'The file must be a JSON object with a "stations" list.': 'Файл должен быть JSON-объектом со списком "stations".',
  'the required field "{field}" wasn\'t found.': 'не найдено обязательное поле "{field}".',
  'must be a list ([...]).': 'должно быть списком ([...]).',
  'must be text.': 'должно быть текстом.',
  'must be an http:// or https:// link.': 'должно быть ссылкой http:// или https://.',
  'must be an object ({...}) with "title" and "url".': 'должно быть объектом ({...}) с "title" и "url".',
  'must be an object ({...}) with a "type".': 'должно быть объектом ({...}) с полем "type".',
  'unknown type "{type}" (known: {types}).': 'неизвестный тип "{type}" (поддерживаются: {types}).',
  'a "json" API needs "text", or "artist" and "title": where those are in its answer.': 'для API типа "json" нужно указать "text" или "artist" и "title" — где эти поля лежат в его ответе.',
  'The catalogue link must start with http:// or https://.': 'Ссылка на каталог должна начинаться с http:// или https://.',
  'The server answered {status}.': 'Сервер ответил {status}.',
  'The file is larger than 2 MB.': 'Файл больше 2 МБ.',
  'The server didn\'t answer in time.': 'Сервер не ответил вовремя.',
  'Couldn\'t download the file: {detail}': 'Не удалось скачать файл: {detail}',

  // Settings
  'Station catalogue': 'Каталог станций',
  'Catalogue link': 'Ссылка на каталог',
  'A link to a JSON file with your stations. It\'s downloaded and its stations are kept (not the file). Update downloads it again; a new link replaces the stations once its file loads.':
    'Ссылка на JSON-файл с вашими станциями. Файл скачивается, сохраняются только станции из него. «Обновить» скачивает его заново; новая ссылка заменяет станции, как только её файл успешно загрузится.',
  'Page to edit the catalogue': 'Страница редактирования конфига',
  'Optional: where you edit the catalogue (a GitHub page, a hosting panel...). With a link here, the station list gets an Open config button that opens it in your browser.':
    'Необязательно: где вы редактируете каталог (страница на GitHub, панель хостинга…). Если ссылка указана, в списке станций появляется кнопка «Открыть конфиг», которая открывает её в браузере.',
  'The link must start with http:// or https://.': 'Ссылка должна начинаться с http:// или https://.',
  'Buffer': 'Буфер',
  'Seconds of a station gathered before it starts playing, to ride out a slow connection. 0: no buffer, it starts at once. Applies the next time a station starts.':
    'Сколько секунд потока накапливается перед началом воспроизведения, чтобы пережить медленное соединение. 0 — без буфера, звук начинается сразу. Применяется при следующем запуске станции.',
  '{n} s': '{n} с',

  // Local history
  'Online history': 'Онлайн-история',
  'Open online history': 'Открыть онлайн-историю',
  'View local history': 'Просмотреть локальную историю',
  'Local history: {station}': 'Локальная история: {station}',
  'The last {n} tracks heard on this station in Lokal, newest first.': 'Последние {n} треков, прозвучавших на этой станции в Lokal, сначала новые.',
  'Nothing has been heard on this station yet.': 'На этой станции ещё ничего не прозвучало.',
  'Copy': 'Скопировать',
  'Copy “{text}”': 'Скопировать «{text}»',
  'Search online': 'Поиск в интернете',
  'Search the web for “{text}”': 'Найти в интернете «{text}»',
  'Online radio local history': 'Локальная история онлайн-радио',
  'The tracks each station played while you listened. Only the full cleanup removes it.': 'Треки, которые играли на каждой станции, пока вы её слушали. Удаляется только полной очисткой.',
  'Local history of online radio stations (the tracks heard on each)': 'Локальная история онлайн-радиостанций (прозвучавшие на каждой треки)',
}
