import { assertEditorialWorkflowRepository } from '../ports/editorial-workflow-repository.js';
import { assertVisualAssetGateway } from '../ports/visual-asset-gateway.js';
import { isReviewOpen, workflowStatusFromLegacy } from '../../proofreading/domain/proofreading.js';
import {
  normalizeEditorialWorkflowState,
  visualFingerprint,
  deriveVisualState,
  deriveFinalReviewState,
  markFinalReviewed,
  setActiveEditorialStage,
  aggregateEditorialStages,
  recommendedEditorialStage
} from '../domain/editorial-workflow.js';

function mapBy(items, key) {
  return new Map((items || []).map(item => [item?.[key], item]));
}

function targetProfiles(state, deviceProfileService) {
  const explicit = (state.finalTargetDeviceIds || [])
    .map(id => deviceProfileService.find?.(id) || deviceProfileService.resolve?.(id))
    .filter(Boolean);
  if (explicit.length) return explicit;
  const preset = deviceProfileService.comparisonPreset?.('essential') || [];
  return preset.length ? preset : [deviceProfileService.defaultProfile()];
}

export class EditorialWorkflowService {
  constructor({
    repository,
    proofreadingService,
    visualGateway,
    deviceProfileService,
    diagnoseFrame,
    clock
  }) {
    this.repository = assertEditorialWorkflowRepository(repository);
    this.proofreadingService = proofreadingService;
    this.visualGateway = assertVisualAssetGateway(visualGateway);
    this.deviceProfileService = deviceProfileService;
    this.diagnoseFrame = diagnoseFrame;
    this.clock = clock;
  }

  async getActiveProjectId() {
    return this.proofreadingService.getActiveProjectId();
  }

  async load(projectId) {
    const [proofreading, bundle] = await Promise.all([
      this.proofreadingService.load(projectId),
      this.repository.getProjectBundle(projectId)
    ]);
    if (!bundle) throw new Error('Проект не найден');

    const editorialState = normalizeEditorialWorkflowState(bundle.workspace.editorialWorkflow, this.clock());
    const assignments = mapBy(bundle.assignments, 'fragmentId');
    const assets = mapBy(bundle.assets, 'assetId');
    const allReviews = new Map();
    for (const review of bundle.reviews || []) {
      if (!allReviews.has(review.fragmentId)) allReviews.set(review.fragmentId, []);
      allReviews.get(review.fragmentId).push(review);
    }
    const profiles = targetProfiles(editorialState, this.deviceProfileService);

    const units = proofreading.units.map(unit => {
      const assignment = assignments.get(unit.fragmentId) || null;
      const asset = assignment?.assetId ? assets.get(assignment.assetId) || null : null;
      const visualState = deriveVisualState(assignment);
      const reviews = (allReviews.get(unit.fragmentId) || []).map(review => ({ ...review, workflowStatus: workflowStatusFromLegacy(review) }));
      const openReviews = reviews.filter(isReviewOpen);
      const frame = {
        fragmentId: unit.fragmentId,
        sceneId: unit.sceneId,
        sceneTitle: unit.sceneTitle,
        chapterId: unit.chapterId,
        chapterTitle: unit.chapterTitle,
        type: unit.type,
        speaker: unit.speaker,
        text: unit.text,
        options: unit.options || [],
        visualPrompt: unit.sceneTitle,
        assignment,
        asset
      };
      const diagnostics = profiles.map(device => ({
        device,
        ...this.diagnoseFrame(frame, device)
      }));
      const textReady = ['reviewed', 'approved'].includes(unit.status);
      const textHash = unit.currentHash;
      const visualHash = visualFingerprint(assignment);
      const finalState = deriveFinalReviewState({
        record: editorialState.finalUnits[unit.fragmentId] || null,
        textHash,
        visualHash,
        textReady,
        visualReady: visualState.ready,
        openReviewCount: openReviews.length,
        diagnostics
      });
      return {
        ...unit,
        textStatus: unit.status,
        textReady,
        assignment,
        asset,
        assetId: assignment?.assetId || null,
        visualStatus: visualState.status,
        visualReady: visualState.ready,
        visualHash,
        finalStatus: finalState.status,
        finalReady: finalState.reviewed,
        finalBlockers: finalState.blockers,
        diagnostics,
        allReviews: reviews,
        openAllReviewCount: openReviews.length
      };
    });

    const stages = aggregateEditorialStages(units);
    return {
      ...proofreading,
      editorialState,
      units,
      stages,
      targetProfiles: profiles,
      assets: bundle.assets || [],
      recommendedStage: recommendedEditorialStage(stages)
    };
  }

  async setActiveStage(projectId, stage) {
    const bundle = await this.repository.getProjectBundle(projectId);
    if (!bundle) throw new Error('Проект не найден');
    const state = setActiveEditorialStage(
      normalizeEditorialWorkflowState(bundle.workspace.editorialWorkflow, this.clock()),
      stage,
      this.clock()
    );
    await this.repository.saveEditorialState(projectId, state);
    return state;
  }

  async setSelection(projectId, unit) {
    return this.repository.setWorkspaceSelection(projectId, {
      fragmentId: unit?.fragmentId || null,
      sceneId: unit?.sceneId || null
    });
  }

  async saveText(projectId, fragmentId, text, reason = 'editorial-workflow-edit') {
    return this.proofreadingService.saveText(projectId, fragmentId, text, reason);
  }

  async markText(projectId, fragmentId) {
    return this.proofreadingService.markUnit(projectId, fragmentId);
  }

  async createReview(projectId, input) {
    return this.proofreadingService.createReview(projectId, input);
  }

  async updateReviewWorkflow(reviewId, status) {
    return this.proofreadingService.updateReviewWorkflow(reviewId, status);
  }

  async importVisual(projectId, fragmentId, file) {
    return this.visualGateway.importAndAssign(projectId, fragmentId, file);
  }

  async assignExistingVisual(projectId, fragmentId, assetId) {
    return this.visualGateway.assignExisting(projectId, fragmentId, assetId);
  }

  async updateVisual(projectId, fragmentId, patch) {
    return this.visualGateway.updateAssignment(projectId, fragmentId, patch);
  }

  async removeVisual(projectId, fragmentId) {
    return this.visualGateway.removeAssignment(projectId, fragmentId);
  }

  async assetObjectUrl(assetId, options = {}) {
    return assetId ? this.visualGateway.assetObjectUrl(assetId, options) : null;
  }

  async completeFinal(projectId, fragmentId) {
    let model = await this.load(projectId);
    let unit = model.units.find(item => item.fragmentId === fragmentId);
    if (!unit) throw new Error('Фрагмент не найден');

    if (!unit.textReady && !unit.reviews?.some(isReviewOpen)) {
      try {
        await this.proofreadingService.markUnit(projectId, fragmentId);
        model = await this.load(projectId);
        unit = model.units.find(item => item.fragmentId === fragmentId);
      } catch (_) {
        // A text review can legitimately keep the final unit open.
      }
    }

    if (!unit) throw new Error('Фрагмент не найден');
    if (unit.finalBlockers.length) {
      return {
        completed: false,
        status: unit.finalStatus,
        blockers: unit.finalBlockers,
        unit
      };
    }

    const next = markFinalReviewed(model.editorialState, fragmentId, {
      textHash: unit.currentHash,
      visualHash: unit.visualHash,
      at: this.clock()
    });
    await this.repository.saveEditorialState(projectId, next);
    return {
      completed: true,
      status: 'reviewed',
      blockers: [],
      state: next
    };
  }

  async setFinalTargetDevices(projectId, deviceIds) {
    const bundle = await this.repository.getProjectBundle(projectId);
    if (!bundle) throw new Error('Проект не найден');
    const state = normalizeEditorialWorkflowState(bundle.workspace.editorialWorkflow, this.clock());
    state.finalTargetDeviceIds = this.deviceProfileService
      .normalizeComparison(deviceIds || [])
      .slice(0, 8);
    state.updatedAt = this.clock();
    await this.repository.saveEditorialState(projectId, state);
    return state;
  }
}
