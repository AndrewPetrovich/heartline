import { assertProofreadingRepository } from '../ports/proofreading-repository.js';
import {
  TEXT_REVIEW_CATEGORIES, REVIEW_WORKFLOW_STATES,
  normalizeProofreadingState, deriveUnitState, markUnitReviewed, flattenProofreadingUnits,
  aggregateStatuses, createTextAnchor, resolveTextAnchor, runDeterministicChecks,
  workflowStatusFromLegacy, legacyStatusFromWorkflow, isReviewOpen, reviewFingerprint,
  findTextMatches, replaceTextMatches, extractReviewRouteSceneIds, analyzeNovelStyle
} from '../domain/proofreading.js';

const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function effectiveText(unit, workspace) {
  return Object.prototype.hasOwnProperty.call(workspace?.textEdits || {}, unit.fragmentId)
    ? String(workspace.textEdits[unit.fragmentId] ?? '')
    : String(unit.sourceText ?? '');
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export class ProofreadingService {
  constructor({ repository, projectService = null, uuid, clock }) {
    this.repository = assertProofreadingRepository(repository);
    this.projectService = projectService;
    this.uuid = uuid;
    this.clock = clock;
  }

  async getActiveProjectId() {
    return (await this.repository.getMostRecentProject())?.projectId || null;
  }

  async load(projectId) {
    const bundle = await this.repository.getProjectBundle(projectId);
    if (!bundle) throw new Error('Проект для вычитки не найден');
    const now = this.clock();
    const state = normalizeProofreadingState(bundle.workspace.proofreading, now);
    const units = flattenProofreadingUnits(bundle.content).map(unit => ({ ...unit, text: effectiveText(unit, bundle.workspace) }));
    const reviewByFragment = groupBy(bundle.reviews.filter(review => review.targetType !== 'image'), review => review.fragmentId);
    const modeled = units.map((unit, index) => {
      const reviews = reviewByFragment.get(unit.fragmentId) || [];
      const derived = deriveUnitState({ state, fragmentId: unit.fragmentId, currentText: unit.text, reviews });
      return {
        ...unit,
        index,
        status: derived.status,
        currentHash: derived.currentHash,
        reviews: reviews.map(review => this.normalizeReviewForPresentation(review, unit.text)),
        openReviewCount: derived.openReviews.length,
        changedAfterReview: derived.status === 'changed'
      };
    });
    const sceneGroups = groupBy(modeled, unit => unit.sceneId);
    const chapterGroups = groupBy(modeled, unit => unit.chapterId);
    const scenes = [];
    for (const [sceneId, sceneUnits] of sceneGroups) {
      const first = sceneUnits[0];
      scenes.push({
        sceneId, title: first.sceneTitle, chapterId: first.chapterId, chapterTitle: first.chapterTitle,
        order: first.sceneOrder, units: sceneUnits, progress: aggregateStatuses(sceneUnits)
      });
    }
    scenes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
    const chapters = [];
    for (const [chapterId, chapterUnits] of chapterGroups) {
      const first = chapterUnits[0];
      const chapterScenes = scenes.filter(scene => scene.chapterId === chapterId);
      chapters.push({ chapterId, title: first.chapterTitle, scenes: chapterScenes, units: chapterUnits, progress: aggregateStatuses(chapterUnits), order: Math.min(...chapterScenes.map(scene => scene.order)) });
    }
    chapters.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ru'));
    const routeCoverage = this.routeCoverage(bundle.content, scenes);
    return {
      project: bundle.project,
      sourceBacked: Boolean(bundle.binding || bundle.project.sourceBacked),
      workspace: bundle.workspace,
      state,
      units: modeled,
      scenes,
      chapters,
      progress: aggregateStatuses(modeled),
      routeCoverage,
      categories: TEXT_REVIEW_CATEGORIES,
      reviewWorkflowStates: REVIEW_WORKFLOW_STATES
    };
  }

  normalizeReviewForPresentation(review, currentText) {
    const workflowStatus = workflowStatusFromLegacy(review);
    const anchor = review.textAnchor || null;
    const resolvedAnchor = anchor ? resolveTextAnchor(currentText, anchor) : null;
    return { ...clone(review), workflowStatus, resolvedAnchor };
  }

  routeCoverage(content, scenes) {
    const sceneProgress = new Map(scenes.map(scene => [scene.sceneId, scene.progress]));
    const routes = content?.storyMetadata?.reviewRoutes || content?.reviewRoutes || [];
    const normalized = [];
    for (const [index, route] of (Array.isArray(routes) ? routes : []).entries()) {
      const sceneIds = extractReviewRouteSceneIds(route);
      if (!sceneIds.length) continue;
      const known = sceneIds.filter(id => sceneProgress.has(id));
      if (!known.length) continue;
      const completed = known.filter(id => ['reviewed', 'approved'].includes(sceneProgress.get(id).status)).length;
      normalized.push({
        id: String(route.id || route.routeId || `route-${index + 1}`),
        title: String(route.name || route.title || route.id || `Маршрут ${index + 1}`),
        sceneIds: known,
        completed,
        total: known.length,
        percent: Math.round(completed / known.length * 100)
      });
    }
    return { routes: normalized, completed: normalized.filter(route => route.completed === route.total).length, total: normalized.length };
  }

  async markUnit(projectId, fragmentId, { approved = false } = {}) {
    const model = await this.load(projectId);
    const unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');
    const unresolved = unit.reviews.filter(review => isReviewOpen(review));
    if (unresolved.length) throw new Error(`Нельзя отметить фрагмент вычитанным: открытых замечаний ${unresolved.length}`);
    const next = markUnitReviewed(model.state, fragmentId, unit.text, this.clock(), approved);
    await this.repository.saveProofreadingState(projectId, next);
    const completedModel = await this.load(projectId);
    if (completedModel.progress.percent === 100 && completedModel.sourceBacked && !completedModel.workspace.dirty && completedModel.workspace.saveState === 'saved' && this.projectService) {
      await this.projectService.markProjectReviewed(projectId, { approved: false }).catch(() => null);
    }
    return next;
  }

  async markScope(projectId, { sceneId = null, chapterId = null, approved = false } = {}) {
    const model = await this.load(projectId);
    const target = model.units.filter(unit => !sceneId || unit.sceneId === sceneId).filter(unit => !chapterId || unit.chapterId === chapterId);
    let state = model.state;
    const skipped = [];
    let completed = 0;
    for (const unit of target) {
      if (unit.reviews.some(review => isReviewOpen(review))) { skipped.push(unit.fragmentId); continue; }
      state = markUnitReviewed(state, unit.fragmentId, unit.text, this.clock(), approved);
      completed++;
    }
    await this.repository.saveProofreadingState(projectId, state);
    return { completed, skipped, state };
  }

  async markProject(projectId, { approved = false } = {}) {
    const result = await this.markScope(projectId, { approved });
    if (result.skipped.length) return { ...result, projectReview: null };
    const model = await this.load(projectId);
    let projectReview = null;
    if (model.sourceBacked && !model.workspace.dirty && model.workspace.saveState === 'saved' && this.projectService) {
      projectReview = await this.projectService.markProjectReviewed(projectId, { approved });
    }
    return { ...result, projectReview };
  }

  nextPending(model, currentFragmentId, direction = 1) {
    const units = model.units;
    if (!units.length) return null;
    const start = Math.max(0, units.findIndex(unit => unit.fragmentId === currentFragmentId));
    for (let step = 1; step <= units.length; step++) {
      const index = (start + direction * step + units.length) % units.length;
      const unit = units[index];
      if (!['reviewed', 'approved'].includes(unit.status)) return unit;
    }
    return null;
  }

  async saveText(projectId, fragmentId, text, reason = 'proofreading-edit') {
    const model = await this.load(projectId);
    const unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');
    const after = String(text ?? '');
    if (after === unit.text) return { changed: false };
    const result = await this.repository.applyTextChanges(projectId, [{ fragmentId, after }], { reason, at: this.clock() });
    return { changed: Boolean(result.events.length), events: result.events };
  }

  async createReview(projectId, { fragmentId, startOffset = null, endOffset = null, category = 'Другое', severity = 'normal', comment, automation = null }) {
    const model = await this.load(projectId);
    const unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');
    const trimmed = String(comment || '').trim();
    if (!trimmed) throw new Error('Комментарий обязателен');
    const hasSelection = Number.isInteger(startOffset) && Number.isInteger(endOffset) && endOffset > startOffset;
    const textAnchor = hasSelection ? createTextAnchor({ text: unit.text, startOffset, endOffset, at: this.clock() }) : null;
    const review = {
      reviewId: `review:${this.uuid()}`,
      projectId,
      versionId: model.project.activeVersionId,
      targetType: 'text',
      fragmentId,
      quotedText: textAnchor?.quotedText || null,
      textAnchor,
      category: TEXT_REVIEW_CATEGORIES.includes(category) ? category : 'Другое',
      severity: severity === 'critical' ? 'critical' : 'normal',
      comment: trimmed,
      workflowStatus: 'open',
      status: legacyStatusFromWorkflow('open'),
      automation: automation ? clone(automation) : null,
      fragmentHashAtCreation: reviewFingerprint(unit.text),
      createdAt: this.clock(),
      updatedAt: this.clock()
    };
    await this.repository.putReview(review);
    return review;
  }

  async updateReviewWorkflow(reviewId, workflowStatus) {
    if (!REVIEW_WORKFLOW_STATES.includes(workflowStatus)) throw new Error('Некорректный статус замечания');
    const review = await this.repository.getReview(reviewId);
    if (!review) throw new Error('Замечание не найдено');
    const next = { ...review, workflowStatus, status: legacyStatusFromWorkflow(workflowStatus), updatedAt: this.clock() };
    await this.repository.updateReview(next);
    return next;
  }

  async upgradeLegacyAnchors(projectId) {
    const model = await this.load(projectId);
    let upgraded = 0;
    for (const unit of model.units) {
      for (const review of unit.reviews) {
        if (review.textAnchor || !review.quotedText) continue;
        const first = unit.text.indexOf(review.quotedText);
        if (first < 0 || unit.text.indexOf(review.quotedText, first + Math.max(1, review.quotedText.length)) >= 0) continue;
        const current = await this.repository.getReview(review.reviewId);
        if (!current) continue;
        current.textAnchor = createTextAnchor({ text: unit.text, startOffset: first, endOffset: first + review.quotedText.length, at: current.createdAt || this.clock() });
        current.workflowStatus ||= workflowStatusFromLegacy(current);
        current.updatedAt = this.clock();
        await this.repository.updateReview(current);
        upgraded++;
      }
    }
    return upgraded;
  }

  async runChecks(projectId, fragmentId) {
    const model = await this.load(projectId);
    const unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');
    return runDeterministicChecks(unit.text, model.state);
  }

  async ignoreFinding(projectId, findingKey) {
    const bundle = await this.repository.getProjectBundle(projectId);
    const state = normalizeProofreadingState(bundle?.workspace?.proofreading, this.clock());
    state.ignoredFindingKeys = [...new Set([...(state.ignoredFindingKeys || []), String(findingKey)])].slice(-5000);
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state;
  }

  async applyFindingFix(projectId, fragmentId, finding) {
    if (finding?.replacement == null) throw new Error('Для этой проверки нет автоматического исправления');
    const model = await this.load(projectId);
    const unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');
    const before = unit.text;
    const after = before.slice(0, finding.startOffset) + finding.replacement + before.slice(finding.endOffset);
    return this.saveText(projectId, fragmentId, after, `proofreading-rule:${finding.code}`);
  }

  async addDictionaryTerm(projectId, { canonical, variants = [], note = '', caseSensitive = false }) {
    const bundle = await this.repository.getProjectBundle(projectId);
    const state = normalizeProofreadingState(bundle?.workspace?.proofreading, this.clock());
    const value = String(canonical || '').trim();
    if (!value) throw new Error('Укажите правильное написание');
    const duplicate = state.dictionary.terms.find(term => term.canonical.toLocaleLowerCase('ru-RU') === value.toLocaleLowerCase('ru-RU'));
    const parsedVariants = [...new Set((Array.isArray(variants) ? variants : String(variants || '').split(/[,\n]/)).map(item => String(item).trim()).filter(Boolean))];
    if (duplicate) {
      duplicate.variants = [...new Set([...duplicate.variants, ...parsedVariants])];
      duplicate.note = String(note || duplicate.note || '');
      duplicate.caseSensitive = Boolean(caseSensitive);
    } else {
      state.dictionary.terms.push({ id: `term:${this.uuid()}`, canonical: value, variants: parsedVariants, note: String(note || ''), caseSensitive: Boolean(caseSensitive) });
    }
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state;
  }

  async removeDictionaryTerm(projectId, termId) {
    const bundle = await this.repository.getProjectBundle(projectId);
    const state = normalizeProofreadingState(bundle?.workspace?.proofreading, this.clock());
    state.dictionary.terms = state.dictionary.terms.filter(term => term.id !== termId);
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state;
  }

  async setForbiddenWords(projectId, words) {
    const bundle = await this.repository.getProjectBundle(projectId);
    const state = normalizeProofreadingState(bundle?.workspace?.proofreading, this.clock());
    state.dictionary.forbiddenWords = [...new Set(String(words || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean))];
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state;
  }

  async updateRules(projectId, patch) {
    const bundle = await this.repository.getProjectBundle(projectId);
    const state = normalizeProofreadingState(bundle?.workspace?.proofreading, this.clock());
    state.rules = { ...state.rules, ...patch };
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state;
  }

  async analyzeNovel(projectId) {
    const model = await this.load(projectId);
    return analyzeNovelStyle(model.units, model.state);
  }

  async saveStyleGuide(projectId, notes) {
    const bundle = await this.repository.getProjectBundle(projectId);
    if (!bundle) throw new Error('Проект не найден');
    const state = normalizeProofreadingState(bundle.workspace.proofreading, this.clock());
    state.styleGuide = { ...(state.styleGuide || {}), notes: String(notes || '').trim() };
    state.updatedAt = this.clock();
    await this.repository.saveProofreadingState(projectId, state);
    return state.styleGuide;
  }

  search(model, { query, replacement = '', regex = false, caseSensitive = false, scope = 'all', chapterId = null } = {}) {
    const results = [];
    for (const unit of model.units) {
      if (scope === 'chapter' && chapterId && unit.chapterId !== chapterId) continue;
      if (scope === 'unreviewed' && ['reviewed', 'approved'].includes(unit.status)) continue;
      if (scope === 'changed' && unit.status !== 'changed') continue;
      const matches = findTextMatches(unit.text, query, { regex, caseSensitive });
      if (!matches.length) continue;
      const after = replacement !== undefined ? replaceTextMatches(unit.text, query, replacement, { regex, caseSensitive }) : unit.text;
      results.push({ fragmentId: unit.fragmentId, chapterId: unit.chapterId, chapterTitle: unit.chapterTitle, sceneId: unit.sceneId, sceneTitle: unit.sceneTitle, before: unit.text, after, matches });
    }
    return { query, replacement, regex, caseSensitive, scope, chapterId, results, matchCount: results.reduce((sum, item) => sum + item.matches.length, 0), fragmentCount: results.length };
  }

  async commitReplace(projectId, preview) {
    const changes = (preview?.results || []).filter(item => item.before !== item.after).map(item => ({ fragmentId: item.fragmentId, after: item.after }));
    if (!changes.length) return { changedFragments: 0, events: [] };
    if (this.projectService) {
      try { await this.projectService.createManualRevision(projectId, { label: 'Перед массовой заменой', note: `Search/replace: ${preview.query}` }); }
      catch (error) { if (error?.status !== 'detached') throw error; }
    }
    const result = await this.repository.applyTextChanges(projectId, changes, { reason: 'proofreading-search-replace', at: this.clock() });
    return { changedFragments: result.events.length, events: result.events };
  }
}
