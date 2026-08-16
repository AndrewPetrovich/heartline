let services = null;

export function setAppServices(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Application services are required');
  services = value;
  return services;
}

export function getAppServices() {
  if (!services) throw new Error('HEARTLINE composition root is not initialized');
  return services;
}
