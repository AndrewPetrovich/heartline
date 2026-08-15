HEARTLINE Editor 3.5 — Proofreading Workspace
============================================

Главное изменение 3.5 — отдельный рабочий режим «Вычитка».

Добавлено
---------
- прогресс вычитки по фрагментам, сценам и главам;
- пять независимых проходов проверки;
- content-hash invalidation только изменённого фрагмента;
- кнопка «Следующее непроверенное»;
- устойчивые текстовые anchors с offsets + prefix/suffix;
- упрощённый workflow замечаний: open / fix-proposed / verify / resolved / wont-fix;
- поиск и замена с preview, scope и safe regex;
- safety revision перед массовой заменой;
- словарь терминологии проекта;
- локальные детерминированные проверки текста;
- coverage по source reviewRoutes;
- финальное подтверждение книги, связанное с source hash.

Изменено
--------
- правки из режима «Вычитка» больше не сбрасывают approved-статус изображения;
- глобальные «Текст вычитан / Утвердить текст» убраны из Export: управление проверкой перенесено в Review Workspace;
- GPT bulk action называется «Применить все технически совместимые», а не «Принять все без конфликтов»;
- на мобильном «Вычитка» становится основным пунктом, а Сториборд доступен через «Ещё».

Сохранность
-----------
Все изменения текста по-прежнему проходят через workspace → Project Core autosave → source hash conflict check → recovery/revision → source save. Granular proofreading state хранится в workspace context и попадает в `.hl-editor/project-context.json`.

Проверка
--------

npm test
npm run check

Ожидаемый результат релизного пакета: 32/32 tests PASS, syntax checks PASS.
