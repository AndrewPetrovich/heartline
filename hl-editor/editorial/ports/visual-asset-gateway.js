export function assertVisualAssetGateway(gateway) {
  const required = ['importAndAssign', 'assignExisting', 'updateAssignment', 'removeAssignment', 'assetObjectUrl'];
  for (const method of required) {
    if (typeof gateway?.[method] !== 'function') throw new TypeError(`VisualAssetGateway.${method} is required`);
  }
  return gateway;
}
