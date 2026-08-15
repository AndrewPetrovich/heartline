HEARTLINE Editor 3.6 — Presentation Design System
==================================================

Goal
----
Make HEARTLINE feel like one coherent editorial workspace instead of a collection
of equally-important tools.

Core UX rule
------------
Each screen should answer:

1. Where am I?
2. What is the current state?
3. Is there a problem?
4. What is the most useful next action?

The Design System therefore uses a restrained blue accent only for recommended
next actions. Success uses green, attention uses amber, destructive/conflict
states use red, and ordinary application chrome stays neutral.

Screen changes
--------------
Library
- top ActionCallout continues the latest proofreading session;
- structural statistics are collapsed under "Структура и статистика";
- persistent version IDs are hidden from the normal card view;
- project cards become quieter and secondary to the main callout.

Proofreading
- empty comment panel becomes contextual onboarding;
- persistent fragmentId is removed from normal proofreading chrome;
- existing durable anchors and review logic are unchanged.

Storyboard
- problem callout points to the next frame without an image;
- card actions appear on hover/focus on desktop and remain visible on mobile.

Graph
- search and zoom remain immediately visible;
- filters, route controls and technical options move under "Настройки вида";
- "Открыть в Читать" is presented as "Открыть в вычитке".

Reviews
- one "next unresolved review" callout;
- bulk actions are collapsed;
- GPT package action becomes visually secondary.

Export
- production preflight becomes the single main status callout;
- technical metrics are collapsed;
- Reports and Local storage move under "Дополнительно";
- source-backed backup status is merged into preflight instead of occupying
  another competing card.

Versions
- screen is presented as editorial history;
- revision creation becomes the main explanatory callout;
- parent technical IDs are removed from the normal presentation.

Global
- shared callout / notice / disclosure components;
- stronger focus-visible state;
- one product accent color;
- contextual Undo/Redo;
- maximum emphasis remains semibold (600).
