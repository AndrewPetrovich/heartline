HEARTLINE Editor 3.4 — Project Core
==================================

Главное изменение
-----------------
HEARTLINE больше не обязан быть только библиотекой копий в IndexedDB. Для постоянной работы появился source-backed режим:

1. Откройте Библиотеку.
2. Нажмите «Подключить папку проекта».
3. Выберите папку, содержащую novel.json.
4. HEARTLINE создаст .hl-editor/context.json один раз и сохранит постоянный projectId.
5. Исправления текста будут записываться обратно в тот же novel.json.

В .hl-editor хранятся context, recovery, revisions, backups и checkpoint служебного состояния.

Безопасность сохранения
-----------------------
- перед overwrite сравнивается expected/actual SHA-256;
- внешнее изменение переводит документ в conflict вместо silent overwrite;
- до записи создаётся recovery;
- revisions имеют retention и autosave rate limit;
- после записи source перечитывается и hash проверяется;
- restore revision создаёт backup/safety revision.

Import / Restore
----------------
«Импортировать как новый» теперь является явной операцией создания нового UUID-проекта.
Project ZIP с уже существующим projectId восстанавливает тот же проект, а не создаёт timestamp-копию.

Migration
---------
IndexedDB schema обновлена до v4. Добавлены sourceBindings, recovery и safetySnapshots. Repair v2 выполняется одной multi-store транзакцией после safety snapshot.

Проверка
--------
npm test      → 14/14 PASS
npm run check → PASS

Подробности: HL_EDITOR_ARCHITECTURE.md и QA_PROJECT_CORE_3_4.md.
