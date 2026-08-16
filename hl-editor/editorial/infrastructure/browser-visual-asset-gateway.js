import * as DB from '../../../heartline-db.js';
import * as Assets from '../../../heartline-assets.js';

function scope(projectId) {
  return DB.workspaceScope(projectId);
}

export class BrowserVisualAssetGateway {
  async importAndAssign(projectId, fragmentId, file) {
    if (!file) throw new Error('Выберите изображение');
    const result = await Assets.importAsset(projectId, file, { source: 'editorial-workflow' });
    const assignment = await Assets.assignAsset(projectId, scope(projectId), fragmentId, result.asset.assetId, { status: 'draft' });
    DB.notifyProjectChanged?.(projectId, 'editorial-visual-import');
    return {
      asset: {
        assetId: result.asset.assetId,
        projectId: result.asset.projectId,
        name: result.asset.name,
        mimeType: result.asset.mimeType,
        width: result.asset.width,
        height: result.asset.height,
        fileSize: result.asset.fileSize,
        sha256: result.asset.sha256
      },
      assignment,
      duplicate: Boolean(result.duplicate)
    };
  }


  async assignExisting(projectId, fragmentId, assetId) {
    if (!assetId) throw new Error('Выберите изображение из библиотеки');
    const asset = await DB.get('assets', assetId);
    if (!asset || asset.projectId !== projectId) throw new Error('Изображение не принадлежит текущему проекту');
    const assignment = await Assets.assignAsset(projectId, scope(projectId), fragmentId, assetId, { status: 'draft' });
    DB.notifyProjectChanged?.(projectId, 'editorial-visual-assign-existing');
    return assignment;
  }

  async updateAssignment(projectId, fragmentId, patch) {
    const assignment = await Assets.updateAssignment(projectId, scope(projectId), fragmentId, patch);
    DB.notifyProjectChanged?.(projectId, 'editorial-visual-update');
    return assignment;
  }

  async removeAssignment(projectId, fragmentId) {
    const assignment = await Assets.removeAssignmentAsset(projectId, scope(projectId), fragmentId);
    DB.notifyProjectChanged?.(projectId, 'editorial-visual-remove');
    return assignment;
  }

  async assetObjectUrl(assetId, options = {}) {
    return Assets.assetObjectUrl(assetId, options);
  }
}
