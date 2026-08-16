import { mergePolicies } from '../config.js';
import { BrowserHashService } from '../infrastructure/browser-hash-service.js';
import { BrowserProjectContextRepository } from '../infrastructure/browser-context-repository.js';
import { HeartlineJsonSourceProjectAdapter } from '../infrastructure/source-adapters/heartline-json-source-adapter.js';
import { HEARTLINE_JSON_SOURCE_POLICY } from '../infrastructure/source-adapters/heartline-json-source-policy.js';
import { ProjectService } from '../application/project-service.js';
import { ImportService } from '../application/import-service.js';
import { SourceAdapterRegistry } from '../application/source-adapter-registry.js';
import { StoryProfileRegistry } from '../application/story-profile-registry.js';
import { setStoryProfileResolver } from '../application/story-profile-runtime.js';
import { GenericStoryProfile } from '../infrastructure/story-profiles/generic-story-profile.js';
import { LegacyHeartlineStoryProfile } from '../infrastructure/story-profiles/legacy-heartline-story-profile.js';
import { BrowserProofreadingRepository } from '../proofreading/infrastructure/browser-proofreading-repository.js';
import { ProofreadingService } from '../proofreading/application/proofreading-service.js';
import { BrowserSampleCatalogRepository } from '../infrastructure/browser-sample-catalog-repository.js';
import { SampleCatalogService } from '../application/sample-catalog-service.js';
import { DeviceProfileService } from '../preview/application/device-profile-service.js';
import { BUILTIN_DEVICE_PROFILE_CATALOG, BUILTIN_DEVICE_COMPARISON_PRESETS, DEFAULT_PREVIEW_DEVICE_ID } from '../preview/infrastructure/builtin-device-profile-catalog.js';
import { setAppServices } from '../application/service-container.js';
import { configureNovelParser } from '../../heartline-domain.js';
import { configureDbAdapters } from '../../heartline-db.js';

const parser = window.HEARTLINEParser;
if (!parser) throw new Error('HEARTLINE parser must be loaded before the composition root');
configureNovelParser(parser);
configureDbAdapters({ parser });

const policies = mergePolicies();
const contextRepository = new BrowserProjectContextRepository();
const sourceAdapterRegistry = new SourceAdapterRegistry();
const heartlineJsonSourceAdapter = new HeartlineJsonSourceProjectAdapter({ policies, parser, sourcePolicy: HEARTLINE_JSON_SOURCE_POLICY });
sourceAdapterRegistry.register(HEARTLINE_JSON_SOURCE_POLICY.adapterId, heartlineJsonSourceAdapter, { isDefault: true });

const projectService = new ProjectService({
  sourceAdapter: sourceAdapterRegistry.defaultAdapter(),
  contextRepository,
  hashService: new BrowserHashService(),
  uuid: () => crypto.randomUUID(),
  clock: () => new Date().toISOString(),
  policies
});

const importService = new ImportService({
  contextRepository, projectService, parser,
  uuid: () => crypto.randomUUID(),
  clock: () => new Date().toISOString(),
  policies
});

const proofreadingRepository = new BrowserProofreadingRepository();
const proofreadingService = new ProofreadingService({
  repository: proofreadingRepository,
  projectService,
  uuid: () => crypto.randomUUID(),
  clock: () => new Date().toISOString()
});

const storyProfileRegistry = new StoryProfileRegistry([GenericStoryProfile, LegacyHeartlineStoryProfile]);
setStoryProfileResolver(content => storyProfileRegistry.resolve(content));

const sampleCatalogService = new SampleCatalogService(new BrowserSampleCatalogRepository('./samples/catalog.json'));
const deviceProfileService = new DeviceProfileService(BUILTIN_DEVICE_PROFILE_CATALOG, {
  defaultId: DEFAULT_PREVIEW_DEVICE_ID,
  comparisonPresets: BUILTIN_DEVICE_COMPARISON_PRESETS,
  maxComparisonDevices: 4
});

export const appServices = Object.freeze({
  policies,
  contextRepository,
  sourceAdapterRegistry,
  projectService,
  importService,
  proofreadingRepository,
  proofreadingService,
  storyProfileRegistry,
  sampleCatalogService,
  deviceProfileService
});

setAppServices(appServices);

window.HEARTLINEStoryProfiles = Object.freeze({
  resolve: content => storyProfileRegistry.resolve(content),
  enrichNovel(content) { return storyProfileRegistry.resolve(content).enrichNovel(content); },
  initialVariables(content) { return storyProfileRegistry.resolve(content).initialVariables(content); },
  staticTargets(content, raw, sceneIds) { return storyProfileRegistry.resolve(content).staticTargets({ content, raw, sceneIds }); }
});

window.HEARTLINEApp = Object.freeze({ services: appServices, version: window.HEARTLINE_BUILD || 'current' });
