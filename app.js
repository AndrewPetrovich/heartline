(() => {
  'use strict';

  const BUILTIN = window.HEARTLINE_BUILTIN_NOVEL;
  const $ = (id) => document.getElementById(id);
  const els = {
    libraryScreen: $('libraryScreen'), playerScreen: $('playerScreen'), novelGrid: $('novelGrid'), libraryCount: $('libraryCount'),
    importBtn: $('importBtn'), importJsonBtn: $('importJsonBtn'), fileInput: $('fileInput'), jsonInput: $('jsonInput'), installBtn: $('installBtn'),
    backToLibraryBtn: $('backToLibraryBtn'), debugBtn: $('debugBtn'), historyBtn: $('historyBtn'), restartBtn: $('restartBtn'), saveBtn: $('saveBtn'),
    sceneBackdrop: $('sceneBackdrop'), sceneLabel: $('sceneLabel'), visualCue: $('visualCue'), novelTitleMini: $('novelTitleMini'), sceneTitleMini: $('sceneTitleMini'), progressBar: $('progressBar'),
    dialoguePanel: $('dialoguePanel'), speakerName: $('speakerName'), thoughtBadge: $('thoughtBadge'), dialogueText: $('dialogueText'), tapHint: $('tapHint'),
    choicePanel: $('choicePanel'), choicePrompt: $('choicePrompt'), choiceOptions: $('choiceOptions'),
    historyDialog: $('historyDialog'), historyList: $('historyList'), debugDialog: $('debugDialog'), debugScene: $('debugScene'), debugVars: $('debugVars'), debugTech: $('debugTech'),
    jumpSceneBtn: $('jumpSceneBtn'), exportStateBtn: $('exportStateBtn'), exportNovelBtn: $('exportNovelBtn'), sceneDialog: $('sceneDialog'), sceneSearch: $('sceneSearch'), sceneList: $('sceneList'),
    importDialog: $('importDialog'), importTitle: $('importTitle'), importStatus: $('importStatus'), installDialog: $('installDialog'), toast: $('toast')
  };

  const INDEX_KEY = 'heartline.library.v1';
  const novelKey = (id) => `heartline.novel.${id}`;
  const progressKey = (id) => `heartline.progress.${id}`;
  let novels = [];
  let currentNovel = null;
  let state = null;
  let deferredInstall = null;
  let toastTimer = null;

  function deepClone(obj) { return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)); }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function hashHue(s) { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) % 360; }
  function countChoices(novel) { return novel.scenes.reduce((n, sc) => n + sc.steps.filter(s => s.type === 'choice').length, 0); }
  function findScene(id) { return currentNovel?.scenes?.find(s => s.id === id) || null; }
  function getVar(name) { return state?.vars?.[name]; }
  function setVar(name, value) { if (!state.vars) state.vars = {}; state.vars[name] = value; }
  function boolVar(name) { return getVar(name) === true || getVar(name) === 'TRUE' || getVar(name) === 1; }

  function loadIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '[]'); } catch (_) { return []; }
  }
  function saveIndex(index) { localStorage.setItem(INDEX_KEY, JSON.stringify(index)); }

  function refreshLibrary() {
    const imported = [];
    const index = loadIndex();
    for (const meta of index) {
      try {
        const raw = localStorage.getItem(novelKey(meta.id));
        if (!raw) continue;
        imported.push(JSON.parse(raw));
      } catch (_) {}
    }
    novels = [BUILTIN, ...imported];
    els.libraryCount.textContent = `${novels.length} ${plural(novels.length, 'новелла', 'новеллы', 'новелл')}`;
    els.novelGrid.innerHTML = novels.map(renderNovelCard).join('');
    els.novelGrid.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => openNovel(btn.dataset.play)));
    els.novelGrid.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => deleteNovel(btn.dataset.delete)));
  }

  function renderNovelCard(novel) {
    const saved = loadProgress(novel.id);
    const progress = saved ? Math.round(((novel.scenes.findIndex(s => s.id === saved.sceneId) + 1) / novel.scenes.length) * 100) : 0;
    const imported = novel.id !== BUILTIN.id;
    return `<article class="novel-card" style="--card-hue:${hashHue(novel.title)}">
      <div class="cover-mark">${novel.id === BUILTIN.id ? 'HEARTLINE • PRELOADED' : 'IMPORTED'}</div>
      ${imported ? `<button class="card-menu" data-delete="${escapeHtml(novel.id)}" title="Удалить">×</button>` : ''}
      <h3>${escapeHtml(novel.title)}</h3>
      <p>${escapeHtml(novel.subtitle || 'Интерактивная новелла')}</p>
      <div class="card-stats"><span>${novel.scenes.length} сцен</span><span>${countChoices(novel)} выборов</span>${saved ? `<span>прогресс ${Math.max(1, progress)}%</span>` : ''}</div>
      <button class="card-btn" data-play="${escapeHtml(novel.id)}">${saved && !saved.ended ? 'Продолжить' : 'Играть'}</button>
    </article>`;
  }

  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  function loadProgress(id) {
    try { return JSON.parse(localStorage.getItem(progressKey(id)) || 'null'); } catch (_) { return null; }
  }
  function saveProgress() {
    if (!currentNovel || !state) return;
    try {
      localStorage.setItem(progressKey(currentNovel.id), JSON.stringify(state));
      els.saveBtn.textContent = 'Сохранено ✓';
    } catch (_) { els.saveBtn.textContent = 'Ошибка сохранения'; }
  }

  function createInitialState(novel) {
    return {
      schemaVersion: 1,
      novelId: novel.id,
      sceneId: novel.startScene || novel.scenes[0].id,
      ip: 0,
      branch: null,
      pendingChoice: null,
      vars: { HONESTY: 0, ATTRACTION: 0, TRUST: 0, PROFESSIONAL_COST: 0 },
      history: [],
      choices: [],
      tech: { bg: '', cg: '', music: '', sfx: '', sprite: '', reaction: '', fade: '' },
      ended: false,
      lastDisplayed: null
    };
  }

  function openNovel(id, forceNew = false) {
    currentNovel = novels.find(n => n.id === id);
    if (!currentNovel) return;
    const saved = !forceNew ? loadProgress(id) : null;
    state = saved && !saved.ended ? saved : createInitialState(currentNovel);
    if (!state.vars) state.vars = {};
    if (!state.history) state.history = [];
    els.libraryScreen.classList.add('hidden');
    els.playerScreen.classList.remove('hidden');
    els.novelTitleMini.textContent = currentNovel.title;
    updateSceneChrome();
    if (state.pendingChoice) {
      const choice = findPendingChoice(state.pendingChoice);
      if (choice) renderChoice(choice);
      else { state.pendingChoice = null; advance(); }
    } else if (state.lastDisplayed) {
      renderDisplay(state.lastDisplayed, false);
    } else {
      advance();
    }
  }

  function backToLibrary() {
    saveProgress();
    els.playerScreen.classList.add('hidden');
    els.libraryScreen.classList.remove('hidden');
    currentNovel = null;
    state = null;
    refreshLibrary();
  }

  function restartNovel() {
    if (!currentNovel) return;
    if (!confirm('Начать новеллу сначала? Текущий прогресс будет заменён.')) return;
    state = createInitialState(currentNovel);
    saveProgress();
    hideChoices();
    updateSceneChrome();
    advance();
  }

  function currentSequence() {
    if (!state.branch) {
      const scene = findScene(state.sceneId);
      return scene ? { steps: scene.steps, ip: state.ip, kind: 'scene' } : null;
    }
    const scene = findScene(state.sceneId);
    const choice = scene?.steps.find(s => s.type === 'choice' && s.id === state.branch.choiceId);
    const opt = choice?.options.find(o => o.id === state.branch.optionId);
    return opt ? { steps: opt.steps, ip: state.branch.ip, kind: 'branch', option: opt } : null;
  }

  function setSequenceIp(kind, ip) {
    if (kind === 'branch') state.branch.ip = ip;
    else state.ip = ip;
  }

  function advance() {
    if (!currentNovel || !state) return;
    if (state.ended) { backToLibrary(); return; }
    if (state.pendingChoice) return;

    let safety = 0;
    while (safety++ < 500) {
      const seq = currentSequence();
      if (!seq) { endWithMessage('Не удалось восстановить ветку.'); return; }
      if (seq.ip >= seq.steps.length) {
        if (seq.kind === 'branch') {
          const fallback = seq.option?.fallbackGoto || null;
          state.branch = null;
          if (fallback) { jumpTo(resolveGoto(fallback)); continue; }
          endWithMessage('Ветка завершилась без перехода.');
          return;
        }
        endWithMessage('Сцена завершилась без перехода.');
        return;
      }

      const idx = seq.ip;
      const step = seq.steps[idx];
      setSequenceIp(seq.kind, idx + 1);

      if (step.type === 'choice') {
        state.pendingChoice = { sceneId: state.sceneId, choiceId: step.id };
        saveProgress();
        renderChoice(step);
        return;
      }

      if (step.type === 'tech') {
        if (step.command === 'IF') {
          const ok = evalCondition(step.value);
          if (!ok) {
            const scope = computeIfScope(seq.steps, idx);
            setSequenceIp(seq.kind, Math.min(seq.steps.length, idx + 1 + scope));
          }
          continue;
        }
        const paused = executeTech(step);
        if (paused || state.ended) return;
        continue;
      }

      if (step.type === 'dialogue' || step.type === 'narration' || step.type === 'thought') {
        state.lastDisplayed = { ...step, sceneId: state.sceneId };
        pushHistory(step);
        renderDisplay(step, true);
        saveProgress();
        updateDebug();
        return;
      }
    }
    endWithMessage('Защитная остановка: слишком много технических переходов подряд.');
  }

  function computeIfScope(steps, ifIndex) {
    const hard = new Set(['BG','MUSIC','SFX','SPRITE','CG','FADE','GOTO','CHOICE','SYSTEM','REACTION']);
    let hardEnd = steps.length;
    let nextIf = -1;
    for (let i = ifIndex + 1; i < steps.length; i++) {
      const s = steps[i];
      if (s.type === 'tech' && s.command === 'IF') { nextIf = i; break; }
      if (s.type === 'tech' && hard.has(s.command)) { hardEnd = i; break; }
    }
    if (nextIf >= 0) return Math.max(0, nextIf - ifIndex - 1);

    // If this is the last IF in a consecutive callback run, mirror the previous
    // callback's approximate length and leave the remainder as common text.
    let prevHard = -1, prevIf = -1;
    for (let i = ifIndex - 1; i >= 0; i--) {
      const s = steps[i];
      if (s.type === 'tech' && hard.has(s.command)) { prevHard = i; break; }
      if (s.type === 'tech' && s.command === 'IF') { prevIf = i; break; }
    }
    if (prevIf > prevHard) {
      const previousLen = ifIndex - prevIf - 1;
      return Math.min(previousLen, Math.max(0, hardEnd - ifIndex - 1));
    }

    // Common production pattern: IF false -> SET flag -> continue common text.
    let k = ifIndex + 1;
    while (k < steps.length && steps[k].type === 'tech' && (steps[k].command === 'SET' || steps[k].command === 'CLEAR')) k++;
    if (k > ifIndex + 1) return k - ifIndex - 1;
    return Math.max(0, hardEnd - ifIndex - 1);
  }

  function evalCondition(expr) {
    const s = String(expr || '').trim().replace(/[.;]+$/, '');
    let m = s.match(/^([A-Z0-9_]+)\s*=\s*(TRUE|FALSE)$/i);
    if (m) return boolVar(m[1]) === (m[2].toUpperCase() === 'TRUE');
    m = s.match(/^([A-Z0-9_]+)\s*(>=|<=|>|<|=)\s*(-?\d+)$/i);
    if (m) {
      const a = Number(getVar(m[1]) || 0), b = Number(m[3]);
      return ({'>':a>b,'<':a<b,'>=':a>=b,'<=':a<=b,'=':a===b})[m[2]];
    }
    return true;
  }

  function executeTech(step) {
    const cmd = step.command, value = step.value || '';
    switch (cmd) {
      case 'BG': state.tech.bg = value; updateBackdrop(); break;
      case 'CG': state.tech.cg = value; updateBackdrop(); break;
      case 'MUSIC': state.tech.music = value; break;
      case 'SFX': state.tech.sfx = value; break;
      case 'SPRITE': state.tech.sprite = value; break;
      case 'REACTION': state.tech.reaction = value; break;
      case 'FADE': state.tech.fade = value; flashFade(); break;
      case 'SET': applySet(value); break;
      case 'CLEAR': applyClear(value); break;
      case 'SYSTEM': executeSystem(value); break;
      case 'GOTO': jumpTo(resolveGoto(value)); break;
      default: break;
    }
    updateDebug();
    return false;
  }

  function applySet(value) {
    const s = value.trim().replace(/[.;]+$/, '');
    let m = s.match(/^([A-Z0-9_]+)\s*([+-]\d+)$/i);
    if (m) { setVar(m[1], Number(getVar(m[1]) || 0) + Number(m[2])); return; }
    m = s.match(/^([A-Z0-9_]+)\s*=\s*(TRUE|FALSE)$/i);
    if (m) { setVar(m[1], m[2].toUpperCase() === 'TRUE'); return; }
    m = s.match(/^([A-Z0-9_]+)\s*=\s*([A-Z0-9_]+)$/i);
    if (m) { setVar(m[1], m[2]); return; }
  }

  function applyClear(value) {
    for (const part of value.split(';')) {
      const key = part.trim().replace(/[.;]+$/, '');
      if (key) setVar(key, false);
    }
  }

  function executeSystem(value) {
    const v = value.trim();
    if (/^Сравнить\s+HONESTY/i.test(v)) {
      evaluateRoute();
      return;
    }
    if (/^END\s+ROUTE_/i.test(v)) {
      const route = (v.match(/ROUTE_[A-Z]+/i) || [''])[0];
      state.ended = true;
      state.lastDisplayed = { type: 'narration', text: `Конец маршрута ${route.replace('ROUTE_','')}.`, sceneId: state.sceneId };
      renderDisplay(state.lastDisplayed, false);
      els.tapHint.textContent = 'нажмите, чтобы вернуться в библиотеку';
      saveProgress();
      return;
    }
    if (/^FLAG_[A-Z0-9_]+\s*=/i.test(v)) {
      for (const part of v.split(';')) applySet(part.trim());
    }
  }

  function evaluateRoute() {
    const scores = [
      ['ROUTE_EQUAL', Number(getVar('HONESTY') || 0)],
      ['ROUTE_FIRE', Number(getVar('ATTRACTION') || 0)],
      ['ROUTE_MASK', Number(getVar('TRUST') || 0)]
    ].sort((a,b) => b[1] - a[1]);
    if (scores[0][1] - scores[1][1] >= 2 && scores.filter(x => x[1] === scores[0][1]).length === 1) {
      setVar('ROUTE_ID', scores[0][0]);
      setVar('DIRECT_ROUTE_CHOICE', false);
    } else {
      setVar('ROUTE_ID', '');
      setVar('DIRECT_ROUTE_CHOICE', true);
    }
  }

  function resolveGoto(raw) {
    let target = String(raw || '').trim().replace(/[.;]+$/, '');
    if (/соответствующая маршрутная сцена/i.test(target)) {
      if (boolVar('FLAG_PACT_EQUAL')) return 'CH03_SC03_EQUAL';
      if (boolVar('FLAG_PACT_FIRE')) return 'CH03_SC03_FIRE';
      if (boolVar('FLAG_PACT_MASK')) return 'CH03_SC03_MASK';
      return 'CH03_SC03_EQUAL';
    }
    if (/согласно ROUTE_ID/i.test(target)) {
      const route = getVar('ROUTE_ID');
      if (route === 'ROUTE_EQUAL') return 'CH06_SC05_EQUAL';
      if (route === 'ROUTE_FIRE') return 'CH06_SC05_FIRE';
      if (route === 'ROUTE_MASK') return 'CH06_SC05_MASK';
      return 'CH06_SC04_DIRECT';
    }
    return target;
  }

  function jumpTo(target) {
    if (!target) return;
    const scene = findScene(target);
    if (!scene) {
      endWithMessage(`Не найден переход: ${target}`);
      return;
    }
    state.sceneId = target;
    state.ip = 0;
    state.branch = null;
    state.pendingChoice = null;
    state.lastDisplayed = null;
    state.tech.cg = '';
    updateSceneChrome();
  }

  function renderDisplay(step, animate) {
    hideChoices();
    const scene = findScene(state.sceneId);
    els.sceneLabel.textContent = scene?.title || state.sceneId;
    els.dialoguePanel.classList.toggle('is-thought', step.type === 'thought');
    els.dialoguePanel.classList.toggle('is-narration', step.type === 'narration');
    if (step.type === 'dialogue') {
      els.speakerName.textContent = step.speaker || '';
      els.speakerName.classList.toggle('hidden', !step.speaker);
      els.thoughtBadge.classList.add('hidden');
    } else if (step.type === 'thought') {
      els.speakerName.textContent = 'СОФИЯ';
      els.speakerName.classList.remove('hidden');
      els.thoughtBadge.classList.remove('hidden');
    } else {
      els.speakerName.textContent = '';
      els.speakerName.classList.add('hidden');
      els.thoughtBadge.classList.add('hidden');
    }
    els.dialogueText.textContent = step.text || '';
    els.tapHint.textContent = state.ended ? 'нажмите, чтобы вернуться в библиотеку' : 'нажмите, чтобы продолжить';
    if (animate) {
      els.dialoguePanel.animate([{opacity:.45, transform:'translateY(6px)'},{opacity:1, transform:'translateY(0)'}], {duration:180, easing:'ease-out'});
    }
    updateSceneChrome();
  }

  function renderChoice(choice) {
    els.choicePrompt.textContent = choice.prompt || 'Выбор';
    els.choiceOptions.innerHTML = '';
    choice.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-option';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => chooseOption(choice, opt));
      els.choiceOptions.appendChild(btn);
    });
    els.choicePanel.classList.remove('hidden');
    els.dialoguePanel.classList.add('hidden');
  }

  function hideChoices() {
    els.choicePanel.classList.add('hidden');
    els.dialoguePanel.classList.remove('hidden');
  }

  function chooseOption(choice, opt) {
    state.pendingChoice = null;
    state.branch = { choiceId: choice.id, optionId: opt.id, ip: 0 };
    state.choices.push({ sceneId: state.sceneId, choiceId: choice.id, optionId: opt.id, label: opt.label, at: Date.now() });
    state.history.push({ type: 'choice', speaker: 'ВЫБОР', text: opt.label, sceneId: state.sceneId });
    if (state.history.length > 400) state.history = state.history.slice(-400);
    hideChoices();
    saveProgress();
    advance();
  }

  function findPendingChoice(ref) {
    const scene = currentNovel?.scenes.find(s => s.id === ref.sceneId);
    return scene?.steps.find(s => s.type === 'choice' && s.id === ref.choiceId) || null;
  }

  function pushHistory(step) {
    const last = state.history[state.history.length - 1];
    const item = { type: step.type, speaker: step.speaker || '', text: step.text, sceneId: state.sceneId };
    if (last && last.type === item.type && last.text === item.text && last.sceneId === item.sceneId) return;
    state.history.push(item);
    if (state.history.length > 400) state.history = state.history.slice(-400);
  }

  function updateSceneChrome() {
    if (!currentNovel || !state) return;
    const scene = findScene(state.sceneId);
    els.sceneTitleMini.textContent = scene ? `${scene.id} · ${scene.title}` : state.sceneId;
    els.sceneLabel.textContent = scene?.title || state.sceneId;
    const idx = Math.max(0, currentNovel.scenes.findIndex(s => s.id === state.sceneId));
    els.progressBar.style.width = `${Math.min(100, Math.max(2, ((idx + 1) / currentNovel.scenes.length) * 100))}%`;
    updateBackdrop();
    updateDebug();
  }

  function updateBackdrop() {
    if (!state || !currentNovel) return;
    const scene = findScene(state.sceneId);
    const seed = `${state.sceneId}|${state.tech.bg}|${state.tech.cg}`;
    els.sceneBackdrop.style.setProperty('--hue', String(hashHue(seed)));
    const cue = state.tech.cg || state.tech.bg || '';
    els.visualCue.textContent = cue;
    els.sceneLabel.textContent = scene?.title || state.sceneId;
  }

  function flashFade() {
    els.sceneBackdrop.animate([{filter:'brightness(1)'},{filter:'brightness(.35)'},{filter:'brightness(1)'}], {duration:500, easing:'ease-in-out'});
  }

  function endWithMessage(message) {
    state.ended = true;
    state.lastDisplayed = { type: 'narration', text: message, sceneId: state.sceneId };
    renderDisplay(state.lastDisplayed, false);
    els.tapHint.textContent = 'нажмите, чтобы вернуться в библиотеку';
    saveProgress();
  }

  function showHistory() {
    els.historyList.innerHTML = (state?.history || []).map(h => `<div class="history-item ${h.type === 'choice' ? 'history-choice' : ''}">
      ${h.speaker ? `<div class="history-speaker">${escapeHtml(h.speaker)}</div>` : ''}
      <div class="history-text">${escapeHtml(h.text)}</div>
    </div>`).join('') || '<div class="muted">История пока пуста.</div>';
    els.historyDialog.showModal();
    setTimeout(() => els.historyDialog.scrollTo(0, els.historyDialog.scrollHeight), 0);
  }

  function updateDebug() {
    if (!currentNovel || !state) return;
    const scene = findScene(state.sceneId);
    els.debugScene.textContent = JSON.stringify({ sceneId: state.sceneId, title: scene?.title, ip: state.ip, branch: state.branch, pendingChoice: state.pendingChoice }, null, 2);
    const sorted = Object.fromEntries(Object.entries(state.vars || {}).sort(([a],[b]) => a.localeCompare(b)));
    els.debugVars.textContent = JSON.stringify(sorted, null, 2);
    els.debugTech.textContent = JSON.stringify(state.tech || {}, null, 2);
  }

  function showDebug() {
    updateDebug();
    els.sceneBackdrop.classList.add('debug-on');
    els.debugDialog.showModal();
  }

  function renderSceneList(filter = '') {
    if (!currentNovel) return;
    const q = filter.trim().toLowerCase();
    const list = currentNovel.scenes.filter(s => !q || s.id.toLowerCase().includes(q) || s.title.toLowerCase().includes(q));
    els.sceneList.innerHTML = list.map(s => `<button class="scene-jump" data-scene="${escapeHtml(s.id)}"><strong>${escapeHtml(s.id)}</strong><span>${escapeHtml(s.title)}</span></button>`).join('');
    els.sceneList.querySelectorAll('[data-scene]').forEach(btn => btn.addEventListener('click', () => {
      state.sceneId = btn.dataset.scene; state.ip = 0; state.branch = null; state.pendingChoice = null; state.lastDisplayed = null; state.ended = false;
      els.sceneDialog.close(); els.debugDialog.close(); els.sceneBackdrop.classList.remove('debug-on'); updateSceneChrome(); saveProgress(); advance();
    }));
  }

  async function handleImport(files) {
    els.importTitle.textContent = 'Разбор сценария';
    els.importStatus.innerHTML = 'Читаю DOCX и стили абзацев…';
    els.importDialog.showModal();
    try {
      const { novel, report } = await window.HEARTLINEParser.importFiles(files);
      persistImportedNovel(novel);
      refreshLibrary();
      els.importStatus.innerHTML = `<div class="ok"><strong>Импорт завершён.</strong></div>
        <p>Файлов DOCX: ${report.files.length}<br>Сцен: ${report.scenes}<br>Выборов: ${report.choices}<br>Игровых абзацев: ${report.paragraphs}<br><strong>Исключено по стилю «НЕ ЭКСПОРТИРОВАТЬ…»: ${report.excluded}</strong></p>
        <p class="muted">Новелла добавлена в библиотеку и хранится локально на устройстве.</p>`;
    } catch (err) {
      els.importStatus.innerHTML = `<div class="error"><strong>Импорт не выполнен.</strong><br>${escapeHtml(err.message || String(err))}</div>`;
    } finally {
      els.fileInput.value = '';
    }
  }

  function persistImportedNovel(novel) {
    const index = loadIndex().filter(x => x.id !== novel.id);
    try {
      localStorage.setItem(novelKey(novel.id), JSON.stringify(novel));
      index.push({ id: novel.id, title: novel.title, addedAt: Date.now() });
      saveIndex(index);
    } catch (err) {
      throw new Error('Не удалось сохранить новеллу локально. Возможно, браузер ограничил объём хранилища.');
    }
  }

  function deleteNovel(id) {
    const novel = novels.find(n => n.id === id);
    if (!novel || id === BUILTIN.id) return;
    if (!confirm(`Удалить «${novel.title}» и её прогресс с этого устройства?`)) return;
    localStorage.removeItem(novelKey(id));
    localStorage.removeItem(progressKey(id));
    saveIndex(loadIndex().filter(x => x.id !== id));
    refreshLibrary();
  }

  async function handleJsonImport(file) {
    try {
      const data = JSON.parse(await file.text());
      const novel = window.HEARTLINEParser.validateNovel(data);
      if (novel.id === BUILTIN.id) novel.id = `${novel.id}-${Date.now().toString(36)}`;
      persistImportedNovel(novel);
      refreshLibrary();
      toast('JSON добавлен в библиотеку');
    } catch (err) { toast(`Ошибка JSON: ${err.message}`); }
    els.jsonInput.value = '';
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function toast(text) {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
  }

  function wireUi() {
    els.importBtn.addEventListener('click', () => els.fileInput.click());
    els.importJsonBtn.addEventListener('click', () => els.jsonInput.click());
    els.fileInput.addEventListener('change', () => { if (els.fileInput.files.length) handleImport(els.fileInput.files); });
    els.jsonInput.addEventListener('change', () => { if (els.jsonInput.files[0]) handleJsonImport(els.jsonInput.files[0]); });
    els.backToLibraryBtn.addEventListener('click', backToLibrary);
    els.dialoguePanel.addEventListener('click', advance);
    els.restartBtn.addEventListener('click', restartNovel);
    els.saveBtn.addEventListener('click', () => { saveProgress(); toast('Прогресс сохранён'); });
    els.historyBtn.addEventListener('click', showHistory);
    els.debugBtn.addEventListener('click', showDebug);
    els.jumpSceneBtn.addEventListener('click', () => { renderSceneList(); els.sceneDialog.showModal(); });
    els.sceneSearch.addEventListener('input', () => renderSceneList(els.sceneSearch.value));
    els.exportStateBtn.addEventListener('click', () => currentNovel && state && downloadJson(state, `${currentNovel.id}-state.json`));
    els.exportNovelBtn.addEventListener('click', () => currentNovel && downloadJson(currentNovel, `${currentNovel.id}.json`));
    document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', () => {
      const d = $(btn.dataset.close); if (d?.open) d.close();
    }));
    els.debugDialog.addEventListener('close', () => els.sceneBackdrop.classList.remove('debug-on'));

    window.addEventListener('keydown', (e) => {
      if (els.playerScreen.classList.contains('hidden')) return;
      if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { if (!state?.pendingChoice) { e.preventDefault(); advance(); } }
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) backToLibrary();
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); deferredInstall = e; els.installBtn.classList.remove('hidden');
    });
    els.installBtn.addEventListener('click', async () => {
      if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; els.installBtn.classList.add('hidden'); }
      else els.installDialog.showModal();
    });
  }

  async function registerPwa() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      try { await navigator.serviceWorker.register('./sw.js'); } catch (_) {}
    }
    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isiOS && !navigator.standalone) els.installBtn.classList.remove('hidden');
  }

  wireUi();
  refreshLibrary();
  registerPwa();
})();
