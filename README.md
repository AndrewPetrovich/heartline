# HEARTLINE Novel Editor v2

Редакторский PWA-проигрыватель интерактивных новелл по финальному ТЗ v2.

## Что реализовано

- Светлый минималистичный интерфейс без декоративной анимации фона.
- Библиотека новелл и несколько версий одной новеллы.
- Импорт DOCX / HEARTLINE JSON / ZIP с DOCX.
- Автоматический validation: Scene ID, Fragment ID, GOTO, IF flags, достижимость сцен.
- Чтение по фрагментам, назад/вперёд без отката story state.
- Отдельное «Переиграть отсюда» с архивированием старой сессии.
- Навигация по главам/сценам в редакторском просмотре без изменения маршрута.
- Замечания к целому фрагменту или выделенному тексту; категории, severity, статусы.
- Прямые правки текста с сохранением оригинала и восстановлением.
- Версии и текстовый diff между редакциями.
- Экспорт структурированного GPT ZIP и импорт revision.json/ZIP.
- Проверка GPT diff, Accept/Reject и создание новой версии из принятых изменений.
- Экспорт master DOCX, JSON, CSV замечаний и полного Backup ZIP.
- IndexedDB с fallback на localStorage; автосохранение после действий.
- Offline PWA.

## Обновление GitHub Pages

Распакуйте ZIP и загрузите **все файлы из этой папки в корень репозитория**, заменив существующие. `index.html` должен лежать в корне ветки `main`. GitHub Pages: `main` → `/(root)`.

После обновления рекомендуется открыть сайт и сделать жёсткое обновление страницы. Service Worker использует новый cache key `heartline-editor-v2-2026-08-07-mobile-1`.

## GPT response format

```json
{
  "baseVersionId": "...",
  "changes": [
    {
      "fragmentId": "FR_...",
      "originalText": "...",
      "revisedText": "...",
      "reason": "...",
      "reviewIds": ["RV_..."]
    }
  ]
}
```

GPT-изменения никогда не применяются автоматически: сначала создаётся Revision Candidate и пользователь принимает/отклоняет каждое предложение.


## Patch 2.0.1 — GPT acceptance UX
- Accepted GPT changes are visible immediately as a safe preview without mutating the base version.
- Added "Показать в тексте" from GPT Diff.
- Resolved reviews (`Принято`, `Отклонено`, `Архив`) no longer clutter the reader or review counter.
- Creating a GPT version now records accepted changes in the version changelog.
- Service Worker cache bumped so GitHub Pages receives the new app.js.


## v2.0.2 startup reliability
- Navigation is wired before IndexedDB initialization.
- Core scripts are cache-busted.
- Service worker uses network-first for HTML/JS/CSS.
- IndexedDB blocked/hung state now shows a recovery message instead of a dead header.

## v2.1 — Mobile Editor
- Полный мобильный режим для iPhone/Android без урезания функций.
- Все 6 разделов доступны в нижней навигации: Библиотека, Читать, Замечания, Версии, GPT, Экспорт.
- Структура сцен и замечания в Reader открываются как touch-friendly bottom sheets с затемнением и кнопкой закрытия.
- Reader получил крупные фиксированные кнопки Назад/Вперёд и компактный «Переиграть отсюда».
- Модальные окна вычитки, редактирования, GPT Diff, import и validation на телефоне открываются во весь экран и корректно работают с экранной клавиатурой.
- Выделение текста кэшируется на 15 секунд, поэтому комментарий к выделенной фразе работает и на мобильных браузерах, где тап по кнопке может снять выделение.
- Увеличены touch-targets, поля ввода используют 16px для предотвращения автозума iOS.
- Добавлены safe-area отступы для iPhone, 100dvh и отдельная оптимизация landscape.
- Табличные/двухколоночные блоки автоматически перестраиваются в один столбец; действия не скрываются.
- Static scene background remains fully non-animated.


## v2.3 — исправление мобильной вёрстки

- Устранено горизонтальное переполнение Reader на телефонах.
- Мобильный режим расширен на узкие планшеты и touch-first устройства.
- Основная навигация всегда фиксируется снизу и показывает все 6 разделов.
- Верхняя панель Reader перестроена в компактную сетку: Сцены / Проверка / Ветка / Замечания.
- Нижние кнопки Назад / Вперёд больше не обрезаются.
- Текстовые фрагменты, варианты выбора, Diff и модальные окна принудительно ограничены шириной viewport.
- Структура сцен и замечания открываются как полноширинные bottom sheets.
- Все core-ресурсы получили новый cache-busting `20260807-230`, чтобы исключить смесь старого CSS и нового JS после обновления GitHub Pages.


## v2.4 Desktop Fix

Исправлена десктопная сетка Reader: мобильный drawer backdrop больше не участвует в CSS Grid, desktop и mobile breakpoints разделены по ширине экрана, добавлена защитная трёхколоночная раскладка для экранов от 1180 px.
