HEARTLINE Editor 3.3 — Story Graph 2.1

Назначение
==========
Версия 3.3 реализует новый аналитический раздел «Граф» по итоговому ТЗ HEARTLINE.
Сложность исходного сценария сохраняется в нормализованной StoryGraphModel, но каждый
режим показывает только тот уровень структуры, который нужен редактору.

Основная навигация
==================
Библиотека · Читать · Сториборд · Граф · Инструменты · Проект

На мобильном:
Библиотека · Читать · Сториборд · Граф · Ещё

Четыре режима Graph
===================
1. Карта сюжета
   - сюжетные линии и их переплетения;
   - StoryBeat вместо стены из обычных сцен;
   - компактные merge-узлы;
   - максимум около 30 крупных элементов по умолчанию;
   - раскрытие до Scene через Outline и Inspector.

2. Карта решений
   - логические Choice вместо всех физических occurrences;
   - для «Лунной клятвы» C15 и C18 нормализованы как одно решение с тремя occurrences;
   - фильтры: основная lattice, все, влияющие на финал, повторяющиеся, локальные;
   - действие «Показать последствия» подсвечивает зависимые узлы.

3. Анализ путей
   - corridor families вместо перечисления всех теоретических прохождений;
   - режимы «Структурные семейства» и «Проверочные маршруты»;
   - для «Лунной клятвы» доступны все 12 source reviewRoutes;
   - толщина потока: сцены / кадры / слова;
   - порог скрытия малых путей 2% / 5% / 10%;
   - пользовательские проценты не имитируются без telemetry.

4. Карта романа
   - крупные структурные блоки: главы или source groups;
   - плотность: события / Choice / слова / замечания;
   - drill-down в другие режимы;
   - для «Последней подачи» сохраняются 10 source groups, для «Лунной клятвы» — 12 глав.

Архитектура
===========
Новые модули:
- heartline-graph-model.js          — нормализация, Decision/occurrence, integrity, fixtures;
- heartline-graph-analysis.js       — StoryBeat, merge, corridor/route families, 4 presentations;
- heartline-graph-layout.js         — детерминированный layout, edge routing, cache, safe fallback;
- heartline-graph-layout-worker.js  — граница для Web Worker layout;
- heartline-graph-renderers.js      — визуализация четырёх режимов;
- heartline-graph-navigation.js     — zoom/pan/pinch/focus;
- heartline-graph.js                — стабильный facade для приложения.

Главные защитные механизмы
==========================
- force-directed layout не используется;
- стабильные layout keys и cache;
- orthogonal/obstacle-aware routing;
- разведение параллельных Choice edges;
- Safe Layered Layout при нарушении quality checks;
- обязательная Graph Integrity проверка;
- source metadata имеет приоритет над inference;
- confidence < 0.75 отправляет сцену в общую/неклассифицированную линию;
- path explosion устранён corridor compression и route-family aggregation;
- технические SET/IF/variables скрыты с canvas и доступны в Inspector.

Управление
==========
- колесо мыши: zoom к курсору;
- средняя кнопка мыши: pan;
- Space + drag: pan;
- touch drag: pan;
- pinch: zoom;
- F: вместить;
- 0: 100%;
- Esc: снять выделение;
- двойной клик по сцене: открыть в «Читать».

Обновление GitHub
=================
1. Распакуйте UPDATE ZIP.
2. Загрузите все файлы в корень репозитория с заменой.
3. Дождитесь завершения GitHub Pages.
4. Один раз откройте:
   https://andrewpetrovich.github.io/heartline/upgrade-v330.html

upgrade-v330.html очищает только старые Service Worker и Cache Storage.
IndexedDB не удаляется: проекты, прогресс, замечания, версии и изображения сохраняются.
