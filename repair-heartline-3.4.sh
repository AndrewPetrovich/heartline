#!/usr/bin/env bash
set -euo pipefail

BASE_COMMIT="62ca19cd81a93b7379e7203693d03a10a8f5eb0a"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Run this script from the root of a local AndrewPetrovich/heartline Git checkout." >&2
  exit 1
fi

git cat-file -e "$BASE_COMMIT^{commit}"

echo "Restoring files accidentally removed from HEARTLINE 3.3 base..."
git restore --source="$BASE_COMMIT" -- \
  '.nojekyll' \
  'QA_REPORT_3_3.md' \
  'README_v330.txt' \
  'SHA256SUMS.txt' \
  'heartline-app.css' \
  'heartline-app.js' \
  'heartline-domain.js' \
  'heartline-engine.js' \
  'heartline-exporter.js' \
  'heartline-graph-analysis.js' \
  'heartline-graph-layout-worker.js' \
  'heartline-graph-layout.js' \
  'heartline-graph-model.js' \
  'heartline-graph-navigation.js' \
  'heartline-graph-renderers.js' \
  'heartline-graph.js' \
  'heartline-graph2.css' \
  'heartline-image-worker.js' \
  'heartline-library-cards.css' \
  'heartline-nav-fix.css' \
  'heartline-nav-fix.js' \
  'heartline-parser.js' \
  'heartline-player-renderer.js' \
  'heartline-project-stats.js' \
  'heartline-reader-cleanup.css' \
  'heartline-reader-hierarchy.css' \
  'icon-192.png' \
  'icon-512.png' \
  'moon-oath.json' \
  'novel.json' \
  'upgrade-v330.html'

echo
echo "Running Project Core tests..."
npm test

echo
echo "Running syntax checks..."
npm run check

echo
echo "Repair completed. Review the diff:"
git status --short
echo
echo "Then run:"
echo "  git add -A"
echo '  git commit -m "Restore HEARTLINE runtime files after 3.4 overlay"'
echo "  git push"
