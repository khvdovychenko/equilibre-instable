# Équilibre instable: застосунок і репозиторій (app-notes)

Репозиторій `khvdovychenko/equilibre-instable` публічний. Він же є сайтом (GitHub Pages): https://khvdovychenko.github.io/equilibre-instable/

У репозиторії немає спойлерів: ні біблії, ні season-plan, ні наслідків виборів. Лише тексти глав, які Христина вже може читати, і її власні дані читання.

## Структура

```
index.html, app.js, style.css, sw.js, manifest.webmanifest, icons/   застосунок (генератор їх не чіпає)
chapters/index.json      список глав. ПИШЕ ГЕНЕРАТОР
chapters/chNN.json       текст глави (формат: chapter-format.md v1.1). ПИШЕ ГЕНЕРАТОР
reader/chNN.json         вибір, фідбек, місце читання, збережені слова глави. ПИШЕ ЗАСТОСУНОК
reader/vocabulary.json   словник Христини (повні картки). ПИШЕ ЗАСТОСУНОК
docs/app-notes.md        цей файл
```

Правило: кожен файл має одного власника. Генератор ніколи не редагує `reader/*`, застосунок ніколи не редагує `chapters/*`. Тому конфліктів немає.

## Що робить генератор для нової глави (команда «далі»)

1. Прочитати з репозиторію (через git або GitHub API, не через Pages: Pages оновлюється із запізненням):
   - `reader/chNN.json` останньої глави: `choice_id` (вибір), `feedback.difficulty` (`facile` / `ok` / `difficile`), `feedback.interest` (1–5), `feedback.comment`, `progress.completed`.
   - `reader/vocabulary.json`: `words` (збережені слова) і `deleted` (видалені, їх не повторювати).
2. Якщо `reader/chNN.json` немає або `progress.completed` = false, Христина главу ще не дочитала: не писати наступну, сказати їй.
3. Прочитати з проєкту bible, season-plan, craft-guide, reader-intro. Зіставити `choice_id` із наслідками в біблії.
4. Написати `chapters/chNN+1.json` за chapter-format v1.1 (БЕЗ блока `reader`). У `review_words` вплітати слова зі `vocabulary.json`.
5. Додати запис у кінець масиву `chapters` у `chapters/index.json`:
   `{ "id": "ch02", "number": 2, "title": "...", "file": "chapters/ch02.json", "cefr": "B1+", "reading_minutes": 5, "generated_at": "YYYY-MM-DD" }`
6. Закомітити й запушити в `main` одним комітом. Застосунок побачить главу при наступному відкритті (GitHub Pages оновлюється за 1–2 хвилини) і покаже її з міткою «Nouveau».
7. Оновити біблію і копію глави в проєкті (`claude/chapters/chNN.json`), як і раніше. Файл `reader-state.md` в проєкті стає резервним: головне джерело вибору і фідбеку тепер `reader/`.

## Формати файлів застосунку

`reader/chNN.json`:
```json
{
  "choice_id": "c01-d",
  "feedback": { "difficulty": "ok", "interest": 4, "comment": null },
  "saved_words": ["w03", "w10"],
  "progress": { "last_segment_id": "s44", "completed": true },
  "submitted_at": "2026-11-24T13:25:17Z",
  "updated_at": "2026-11-24T13:25:17Z"
}
```
`saved_words`: id слів із `highlights` цієї глави, які є в словнику зараз. `completed` стає true, коли Христина підтвердила вибір і фідбек. Поки вона лише читає, `choice_id` = null, а `last_segment_id` показує, де вона зупинилась.

`reader/vocabulary.json`:
```json
{
  "schema_version": "1.0",
  "updated_at": "...",
  "words": [
    { "id": "w03@ch01", "lemma": "incohérent(e)", "pos": "adjectif", "definition_fr": "...",
      "translation_en": "...", "example": "...", "cefr": "B2", "surface": "incohérente",
      "chapter": 1, "chapter_id": "ch01", "chapter_title": "La marge", "added_at": "..." }
  ],
  "deleted": [ { "id": "w05@ch01", "deleted_at": "..." } ]
}
```
`id` слова = `id` з `highlights` + `@` + id глави. Саме так записується `dictionary_ref` у `review_words`.

## Повтор слів у нових главах

- Для кожного слова з `words` генератор по можливості вплітає його (або його форму) в нову главу і додає запис у `review_words` з `dictionary_ref` = `id` слова. Застосунок не підсвічує такі слова як нові, але тап по ним відкриває картку зі словника (тонке пунктирне підкреслення).
- Слова з `deleted` не повторювати. Слова, які Христина не зберегла, повторювати за власним розсудом.
- Не вплітати в одну главу більше слів, ніж природно вміщається в текст.

## Що застосунок вміє (щоб знати, чого очікувати від JSON)

- Типи сегментів: `scene`, `narration`, `dialogue`, `thought`, `message`, `document`, `interlude`.
- Перспектива: перспектива першого сегмента глави вважається «основною» (героїня). Сегменти з іншою `perspective` застосунок обводить рамкою кольору цього персонажа з іменем зверху. Інтерлюдія (`interlude`) відкриває нову рамку, її `text` стає заголовком рамки.
- Групи повідомлень: послідовні `message` з однаковим `message.chat` йдуть в один екран чату. Повідомлення, де `sender` = основна героїня, показуються справа.
- Підсвічування: по `start`/`end` (UTF-16). Якщо зріз не збігається з `surface`, застосунок шукає `surface` за `occurrence`. Усе одно перевіряти `text.slice(start, end) === surface` перед збереженням.
- Інтерфейс застосунку французькою з англійськими підказками.

## Синхронізація (для довідки)

Токен (fine-grained, Contents: Read and write, лише цей репозиторій) зберігається в localStorage телефона Христини і ніколи не потрапляє в репозиторій. Застосунок пише в `reader/*` через GitHub API. Без токена застосунок працює локально і лише читає файли з репозиторію.

Конфлікти: для `reader/chNN.json` перемагає запис з пізнішим `updated_at`; для словника в кожного слова перемагає пізніша дія (додавання або видалення).
