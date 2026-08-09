# HEARTLINE Editor 3.3 — QA Report

## Объём проверки

Релиз проверен как новый Story Graph 2.1 поверх существующего HEARTLINE Editor.
Источниками fixture-данных были два приложенных HEARTLINE-пакета:

- «Последняя подача» — Branching Edition 2.0;
- «Лунная клятва» — proofreading-v5-branch-lattice.

## Автоматическая проверка сборки

Команда:

```text
npm test
```

Результат:

```text
Built app.d25170fe93.js + styles.3a5bb248b2.css
Story Graph 2.1 fixture, aggregation, route and layout tests: PASS
```

Дополнительно выполнено:

- `node --check` для всех корневых JS, build-скрипта и тестов;
- JSON validation для `novel.json`, `moon-oath.json`, `manifest.webmanifest`;
- проверка целостности итоговых ZIP-пакетов.

## Fixture A — «Последняя подача»

| Метрика | Получено | Эталон | Статус |
|---|---:|---:|---|
| Scenes | 72 | 72 | PASS |
| Choice occurrences | 25 | 25 | PASS |
| Choice options | 61 | 61 | PASS |
| Explicit source edges | 106 | 106 | PASS |
| Branch points | 25 | 25 | PASS |
| Merge points | 20 | 20 | PASS |
| Max fan-in | 6 | 6 | PASS |
| Max fan-out | 4 | 4 | PASS |
| Broken targets | 0 | 0 | PASS |

Нормализованные storyline lanes:
`common / equal / fire / mask / direct`.

## Fixture B — «Лунная клятва»

| Метрика | Получено | Эталон | Статус |
|---|---:|---:|---|
| Chapters | 12 | 12 | PASS |
| Scenes | 100 | 100 | PASS |
| Story blocks | 2 991 | 2 991 | PASS |
| Choice occurrences | 31 | 31 | PASS |
| Unique Choice IDs | 27 | 27 | PASS |
| Choice options | 96 | 96 | PASS |
| Main lattice C01–C22 | 22 | 22 | PASS |
| C15 occurrences | 3 | 3 | PASS |
| C18 occurrences | 3 | 3 | PASS |
| Branch markers | 180 | 180 | PASS |
| Variables | 74 | 74 | PASS |
| Review routes | 12 | 12 | PASS |
| Endings | 3 | 3 | PASS |

Проверено, что C15 и C18 существуют как по одному logical Decision и содержат по
три физические occurrences.

## Проверка четырёх представлений

### «Последняя подача»

| Вид | Ноды | Связи | Overlap | Edge through node | Label overlap | Safe fallback |
|---|---:|---:|---:|---:|---:|---|
| Карта сюжета | 30 | 49 | 0 | 0 | 0 | нет |
| Карта решений | 29 | 33 | 0 | 0 | 0 | нет |
| Анализ путей | 26 | 30 | 0 | 0 | 0 | нет |
| Карта романа | 10 | 9 | 0 | 0 | 0 | нет |

### «Лунная клятва»

| Вид | Ноды | Связи | Overlap | Edge through node | Label overlap | Safe fallback |
|---|---:|---:|---:|---:|---:|---|
| Карта сюжета | 30 | 45 | 0 | 0 | 0 | нет |
| Карта решений | 26 | 25 | 0 | 0 | 0 | нет |
| Анализ путей — structural | 26 | 25 | 0 | 0 | 0 | нет |
| Анализ путей — 12 reviewRoutes | 15 | 25 | 0 | 0 | 0 | нет |
| Карта романа | 12 | 11 | 0 | 0 | 0 | нет |

В режиме «Все проверочные маршруты» допускаются визуальные пересечения потоков,
поскольку одновременно накладываются все 12 source routes. Для редакторской проверки
каждый маршрут R01–R12 можно выбрать отдельно, что снимает визуальный шум.

## Проверка агрегации

- Карта сюжета: не более 30 крупных элементов;
- Карта решений: не более 35 стратегических элементов;
- «Лунная клятва»: main scope показывает ровно 22 logical Decisions C01–C22;
- 2 991 story blocks не материализуются как 2 991 canvas nodes;
- все 12 reviewRoutes доступны;
- переключение structural/review mode не повторно использует несовместимый cache layout.

## Проверка стабильности layout

В тесте изменялась только проза первого текстового фрагмента «Лунной клятвы».
Для совпадающих структурных нод смещение осталось в пределах требования ±16 px.

## Проверка интерфейса

В браузерном smoke-test этой кодовой линии проверены:

- обе встроенные новеллы;
- все четыре Graph view;
- отсутствие JavaScript page errors;
- отсутствие body horizontal overflow на desktop и mobile 390×844;
- открытие Inspector как bottom sheet на mobile;
- отображение layout badge `Layout: 0 overlap`;
- сохранение прямой навигации `Библиотека / Читать / Сториборд / Граф`.

## Известная особенность

«Анализ путей → Проверочные маршруты → Все» намеренно показывает наложение всех
12 source-driven reviewRoutes. Это не пользовательская статистика и не оценка
популярности. Для максимально чистой проверки следует выбирать один R01–R12.

## Итог

- Fixture fidelity: PASS
- Integrity: PASS
- Graph aggregation: PASS
- Layout hard criteria: PASS
- Build/syntax/JSON: PASS
- IndexedDB migration: не требуется; schema не изменена
