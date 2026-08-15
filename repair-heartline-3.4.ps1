$ErrorActionPreference = "Stop"

$BaseCommit = "62ca19cd81a93b7379e7203693d03a10a8f5eb0a"
$Files = @(
    ".nojekyll",
    "QA_REPORT_3_3.md",
    "README_v330.txt",
    "SHA256SUMS.txt",
    "heartline-app.css",
    "heartline-app.js",
    "heartline-domain.js",
    "heartline-engine.js",
    "heartline-exporter.js",
    "heartline-graph-analysis.js",
    "heartline-graph-layout-worker.js",
    "heartline-graph-layout.js",
    "heartline-graph-model.js",
    "heartline-graph-navigation.js",
    "heartline-graph-renderers.js",
    "heartline-graph.js",
    "heartline-graph2.css",
    "heartline-image-worker.js",
    "heartline-library-cards.css",
    "heartline-nav-fix.css",
    "heartline-nav-fix.js",
    "heartline-parser.js",
    "heartline-player-renderer.js",
    "heartline-project-stats.js",
    "heartline-reader-cleanup.css",
    "heartline-reader-hierarchy.css",
    "icon-192.png",
    "icon-512.png",
    "moon-oath.json",
    "novel.json",
    "upgrade-v330.html"
)

if (-not (git rev-parse --is-inside-work-tree 2>$null)) {
    throw "Run this script from the root of a local AndrewPetrovich/heartline Git checkout."
}

Write-Host "Restoring files accidentally removed from HEARTLINE 3.3 base..." -ForegroundColor Cyan
git cat-file -e "$BaseCommit^{commit}"
git restore --source=$BaseCommit -- $Files

Write-Host "`nRestored. Running Project Core tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test failed" }

Write-Host "`nRunning syntax checks..." -ForegroundColor Cyan
node --check heartline-db.js
node --check heartline-assets.js
node --check sw.js
Get-ChildItem -Path "hl-editor" -Recurse -Filter "*.js" | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "node --check failed: $($_.FullName)" }
}

Write-Host "`nRepair completed. Review the diff before committing:" -ForegroundColor Green
git status --short
Write-Host ""
Write-Host "Then run:"
Write-Host "  git add -A"
Write-Host '  git commit -m "Restore HEARTLINE runtime files after 3.4 overlay"'
Write-Host "  git push"
