import { access, readFile } from 'node:fs/promises';

const required = [
  'index.html','heartline-app.js','heartline-app.css','heartline-typography.css','heartline-domain.js','heartline-engine.js','heartline-exporter.js','heartline-parser.js','heartline-assets.js','heartline-db.js',
  'heartline-graph.js','heartline-graph-model.js','heartline-graph-analysis.js','heartline-graph-layout.js','heartline-graph-layout-worker.js','heartline-graph-renderers.js','heartline-graph-navigation.js','heartline-graph2.css',
  'heartline-player-renderer.js','heartline-project-stats.js','heartline-image-worker.js','heartline-nav-fix.js','heartline-nav-fix.css','heartline-reader-cleanup.css','heartline-reader-hierarchy.css','heartline-library-cards.css',
  'novel.json','moon-oath.json','icon-192.png','icon-512.png','manifest.webmanifest','sw.js',
  'hl-editor/index.js','hl-editor/presentation/design-system.js','hl-editor/presentation/design-system.css','hl-editor/presentation/font-policy.js','hl-editor/presentation/font-policy.css','hl-editor/presentation/presentation-coordinator.js','hl-editor/bootstrap/composition-root.js','hl-editor/preview/domain/device-profile.js','hl-editor/preview/application/device-profile-service.js','hl-editor/preview/infrastructure/builtin-device-profile-catalog.js','hl-editor/preview/presentation/preview-lab.css','hl-editor/application/story-profile-runtime.js','hl-editor/application/story-profile-registry.js','hl-editor/application/service-container.js','hl-editor/application/source-adapter-registry.js','hl-editor/application/legacy-editor-gateway.js','hl-editor/application/asset-application-service.js','hl-editor/application/sample-catalog-service.js','hl-editor/ports/story-format-profile.js','hl-editor/ports/sample-catalog-repository.js','hl-editor/infrastructure/story-profiles/generic-story-profile.js','hl-editor/infrastructure/story-profiles/legacy-heartline-story-profile.js','hl-editor/infrastructure/source-adapters/heartline-json-source-adapter.js','hl-editor/infrastructure/source-adapters/heartline-json-source-policy.js','hl-editor/infrastructure/browser-sample-catalog-repository.js','samples/catalog.json','hl-editor/application/project-service.js','hl-editor/infrastructure/browser-context-repository.js','hl-editor/presentation/bridge.js',
  'hl-editor/proofreading/domain/proofreading.js','hl-editor/proofreading/application/proofreading-service.js','hl-editor/proofreading/ports/proofreading-repository.js','hl-editor/proofreading/infrastructure/browser-proofreading-repository.js','hl-editor/proofreading/presentation/proofreading-workspace.js','hl-editor/proofreading/presentation/proofreading.css'
];

const missing=[];
for(const path of required){try{await access(path);}catch{missing.push(path)}}
if(missing.length){
  console.error('HEARTLINE release is incomplete. Missing files:\n'+missing.map(path=>' - '+path).join('\n'));
  process.exit(1);
}

const index=await readFile('index.html','utf8');
if(!index.includes('hl-editor/index.js')||!index.includes('heartline-typography.css')){
  console.error('index.html is not wired to HEARTLINE Project Core / Proofreading / typography policy');
  process.exit(1);
}

const editorEntry=await readFile('hl-editor/index.js','utf8');
if(!editorEntry.includes("presentation/font-policy.js")||!editorEntry.includes("presentation/presentation-coordinator.js")||!editorEntry.includes("bootstrap/composition-root.js")){
  console.error('hl-editor/index.js is not wired to the unified font/library Presentation policies');
  process.exit(1);
}

for(const file of ['manifest.webmanifest','novel.json','moon-oath.json']){
  try{JSON.parse(await readFile(file,'utf8'))}
  catch(error){console.error(`${file} is invalid JSON: ${error.message}`);process.exit(1)}
}

console.log(`Repository completeness: PASS (${required.length} required files)`);
