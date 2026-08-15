import { readFile } from 'node:fs/promises';

const css = await readFile('heartline-typography.css', 'utf8');
const index = await readFile('index.html', 'utf8');
const workspace = await readFile('hl-editor/proofreading/presentation/proofreading-workspace.js', 'utf8');

if (!/html body \*\s*\{\s*font-weight:400!important\s*\}/.test(css)) {
  console.error('Typography policy must neutralize legacy weights globally.');
  process.exit(1);
}
if (!/font-weight:600!important/.test(css)) {
  console.error('Typography policy must define semibold as the strongest emphasis.');
  process.exit(1);
}
const weights = [...css.matchAll(/font-weight\s*:\s*(\d+)/g)].map(match => Number(match[1]));
if (weights.some(weight => weight > 600)) {
  console.error('Typography policy contains a font weight above 600.');
  process.exit(1);
}
if (!index.includes('heartline-typography.css')) {
  console.error('Typography policy is not loaded by index.html.');
  process.exit(1);
}
if (workspace.includes('id="hlProofRunChecks"')) {
  console.error('Standalone “Проверить текст” button must not be rendered.');
  process.exit(1);
}
if (workspace.includes('data-proof-tab="dictionary"') || workspace.includes('data-proof-tab="quality"')) {
  console.error('Proofreading side pane must not render Checks/Dictionary tabs.');
  process.exit(1);
}
console.log('Typography/UI simplification policy: PASS');
