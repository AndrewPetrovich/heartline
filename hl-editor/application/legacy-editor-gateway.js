// Transitional Application boundary for the legacy Presentation shell.
// New Presentation code must prefer explicit use cases/services. This gateway
// exists so heartline-app.js no longer imports IndexedDB infrastructure directly.
export * from '../../heartline-db.js';
