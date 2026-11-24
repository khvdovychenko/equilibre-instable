# Équilibre instable: застосунок і репозиторій (app-notes), версія 2.0

Репозиторій `khvdovychenko/equilibre-instable` публічний. Він же є сайтом (GitHub Pages): https://khvdovychenko.github.io/equilibre-instable/

У репозиторії немає спойлерів: ні біблії, ні season-plan, ні наслідків виборів. Лише тексти глав, які Христина вже може читати, і її власні дані читання.

## Структура (кілька історій)

```
index.html, app.js, style.css, sw.js, manifest.webmanifest, icons/   застосунок (генератор їх не чіпає)

stories/index.json                    список історій. ПИШЕ ГЕНЕРАТОР
stories/<story>/index.json            список глав однієї історії. ПИШЕ ГЕНЕРАТОР
stories/<story>/chapters/chNN.json    текст глави (формат: chapter-format.md v1.1). ПИШЕ ГЕНЕРАТОР
lexicon/cards.json                    картки слів, які Христина додала тапом по довільному слову. ПИШЕ ГЕНЕРАТОР

reader/<story>/chNN.json              вибір, фідбек, місце читання, збережені слова глави. ПИШЕ ЗАСТОСУНОК
reader/vocabulary.json                ОДИН словник на всі історії. ПИШЕ ЗАСТОСУНОК

docs/app-notes.md                     цей файл
```

Правило: кожен файл має одного власника. Генератор пише лише `stories/*` і `lexicon/*`. Застосунок пише лише `reader/*`. Конфліктів немає.

Поточна історія: `<story>` = `equilibre-instable`.

### stories/index.json
```json
{ "stories": [
  { "id": "equilibre-instable", "title": "Équilibre instable", "synopsis": "...", "index": "stories/equilibre-instable/index.json", "cover": null }
] }
```
`cover` необов'язковий. Без нього застосунок показує плитку з першою літерою назви.

### stories/<story>/index.json
Ті самі записи, що були в `chapters/index.json`, але `file` тепер від кореня репозиторію:
```json
{ "id": "ch02", "number": 2, "title": "...", "file": "stories/equilibre-instable/chapters/ch02.json",
  "cefr": "B1+", "reading_minutes": 5, "generated_at": "YYYY-MM-DD" }
```

## Що робить генератор (команда «далі»)

Для будь-якої історії порядок однаковий.

1. Прочитати з репозиторію (через git або GitHub API, не через Pages: Pages оновлюється із запізненням):
   - `reader/<story>/chNN.json` останньої глави: `choice_id`, `feedback.difficulty` (`facile` / `ok` / `difficile`), `feedback.interest` (1–5), `feedback.comment`, `progress.completed`.
   - `reader/vocabulary.json`: `words` і `deleted`. Словник спільний: слова з ІНШИХ історій теж треба вплітати в нову главу будь-якої історії.
   - `lexicon/cards.json`: які слова вже мають картку.
2. Якщо `reader/<story>/chNN.json` немає або `progress.completed` = false, главу ще не дочитано: не писати наступну, сказати Христині.
3. Прочитати з проєкту bible, season-plan, craft-guide, reader-intro. Зіставити `choice_id` із наслідками в біблії.
4. Написати `stories/<story>/chapters/chNN+1.json` за chapter-format v1.1. У `review_words` вплітати слова зі `vocabulary.json` (з усіх історій).
5. Додати запис у кінець `chapters` у `stories/<story>/index.json`. Нова історія: створити `stories/<id>/index.json`, главу, і додати історію в `stories/index.json`.
6. Заповнити картки (див. нижче).
7. Закомітити й запушити в `main` одним комітом. Застосунок побачить зміни при відкритті або по кнопці «Actualiser» (Pages оновлюється за 1–2 хвилини).
8. Оновити біблію і копію глави в проєкті, як і раніше.

## Слова з довільного тапа і lexicon/cards.json

Христина може торкнутися будь-якого слова в тексті й додати його в словник. Таке слово потрапляє в `reader/vocabulary.json` зі статусом картки `pending` (без визначення і перекладу).

Запис `pending`-слова:
```json
{ "id": "equilibre-instable/ch01/x-s02-10", "surface": "Quelqu'un", "segment_id": "s02",
  "sentence": "Quelqu'un écrit sur mon tableau.", "form_start": 0,
  "story": "equilibre-instable", "chapter": 1, "chapter_id": "ch01", "chapter_title": "La marge",
  "added_at": "...", "card_status": "pending", "srs": { ... } }
```
`id` довільного слова = `<story>/chNN/x-<segment_id>-<початок слова в тексті сегмента>`. `sentence` це речення з текстом, `form_start` позиція слова в ньому.

Генератор при кожній главі знаходить у `reader/vocabulary.json` слова з `card_status: "pending"` і додає їх у `lexicon/cards.json`:
```json
{ "equilibre-instable/ch01/x-s02-10": {
    "lemma": "quelqu'un", "pos": "pronom", "definition_fr": "...", "translation_en": "...",
    "example": "...", "cefr": "A2" } }
```
Ключ = `id` слова. Усі шість полів обов'язкові. Файл лише додає записи, старі не видаляє.

Застосунок при синхронізації зливає картки у свій словник, прибирає `pending` і ставить `srs.due_at = max(due_at, P + 1)`. Слово стає звичайним.

## Повторення (srs)

У кожного слова словника є поле `srs`:
```json
{ "status": "new|learning|mastered", "interval": 0, "due_at": 4, "reps": 0, "lapses": 0,
  "history": [ { "story": "equilibre-instable", "chapter": 2, "grade": "good", "at": "..." } ] }
```
- `P` = (кількість глав із `completed: true` у ВСІХ історіях, рахується з `reader/`) + 1. Інтервали рахуються в главах.
- `grade`: `again`, `hard`, `good`, `easy`, а також `reset` (кнопка «Revoir encore», на розклад не впливає).
- Нове слово: `new`, `interval` 0, `due_at` = P + 1. `pending`-слова в повторенні не беруть участі.
- Екран «Révision» з'являється після тексту глави, перед вибором, лише при першому читанні. Кандидати: `due_at <= P`, статус не `mastered`, картка не `pending`. Порядок: менший `due_at`, більше `lapses`, давніше додане. Максимум 5.
- Оцінки: À revoir: I=1, lapses+1. Difficile: I = (I=0 ? 1 : max(I+1, round(I*1.2))). Bien: I = (I=0 ? 2 : round(I*2.5)). Facile: I = (I=0 ? 4 : round(I*3.5)). Далі reps+1, `due_at` = P + I, запис в `history`, статус `learning`. Якщо Bien або Facile і I >= 30, статус `mastered`.
- Рівні (не зберігаються, рахуються): 0 Nouveau (reps=0), 1 Fragile (інтервал 1–2 або остання оцінка À revoir), 2 En cours (3–7), 3 Solide (8–19), 4 Presque (20–29), 5 Maîtrisé (>=30 або `mastered`). Слово з `pending` показується як «en attente».
- Поява слова в тексті нової глави на розклад не впливає. Видалене слово зникає з повторення.

Генератору `srs` читати корисно (які слова слабкі, їх варто вплітати частіше), але змінювати не можна.

## Формати файлів застосунку

`reader/<story>/chNN.json`:
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
`saved_words`: id слів із `highlights` цієї глави, які є в словнику зараз (довільні слова `x-...` сюди не входять). `completed` стає true, коли Христина підтвердила вибір і фідбек.

`reader/vocabulary.json`:
```json
{
  "schema_version": "2.0",
  "updated_at": "...",
  "words": [
    { "id": "equilibre-instable/ch01/w02", "lemma": "effacer", "pos": "verbe", "definition_fr": "...",
      "translation_en": "...", "example": "...", "cefr": "B1", "surface": "a effacé",
      "story": "equilibre-instable", "chapter": 1, "chapter_id": "ch01", "chapter_title": "La marge",
      "segment_id": "s03", "sentence": "Avec le pouce, il a effacé le prix du cappuccino.", "form_start": 18,
      "added_at": "...", "srs": { ... } }
  ],
  "deleted": [ { "id": "equilibre-instable/ch01/w05", "deleted_at": "..." } ]
}
```
`id` слова = `<story>/<chapter id>/<id з highlights>`. Саме так записується `dictionary_ref` у `review_words`: `equilibre-instable/ch02/w03`. Картка в застосунку показує історію і главу.

## Повтор слів у нових главах

- Для кожного слова з `words` (усіх історій) генератор по можливості вплітає його або його форму в нову главу і додає запис у `review_words` з `dictionary_ref` = `id` слова. Застосунок не підсвічує такі слова як нові, але тап відкриває картку зі словника (тонке пунктирне підкреслення).
- Слова з `deleted` не повторювати. Не вплітати більше слів, ніж природно вміщається.

## Що застосунок вміє

- Типи сегментів: `scene`, `narration`, `dialogue`, `thought`, `message`, `document`, `interlude`.
- Перспектива: перспектива першого сегмента глави основна (героїня). Інші перспективи застосунок обводить рамкою кольору персонажа з іменем. `interlude` відкриває нову рамку.
- Групи повідомлень: послідовні `message` з однаковим `message.chat` йдуть в один екран чату.
- Підсвічування: по `start`/`end` (UTF-16). Перевіряти `text.slice(start, end) === surface`.
- Будь-яке слово тексту (довше за 1 літеру) тапається: міні-картка з реченням, історією, главою, коротким значенням із Wiktionary (якщо є) і кнопкою WordReference.
- Налаштування «Sélection du texte» (за замовчуванням вимкнено): коли ввімкнено, довгий натиск виділяє текст як на iPhone, а тап усе одно відкриває картку.
- Інтерфейс французькою з англійськими підказками.

## Синхронізація

Токен (fine-grained, Contents: Read and write, лише цей репозиторій) зберігається в localStorage телефона й ніколи не потрапляє в репозиторій. Застосунок пише в `reader/*` через GitHub API. Без токена працює локально й лише читає файли.

Порядок: глави (читання) → `lexicon/cards.json` → словник (злиття, заповнення карток) → запис глав і словника.

Конфлікти: для `reader/<story>/chNN.json` перемагає запис з пізнішим `updated_at`; для словника в кожного слова перемагає пізніша дія (додавання або видалення); `srs` слова: перемагає запис із пізнішою останньою оцінкою в `history`, а при рівності більше `reps`.

Сумісність: застосунок розуміє старі id `wNN@chNN` і старий локальний стан (v1) та перетворює їх.
