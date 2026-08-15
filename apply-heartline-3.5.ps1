$ErrorActionPreference = "Stop"
if (-not (git rev-parse --is-inside-work-tree 2>$null)) { throw "Run from the HEARTLINE repository root" }
Remove-Item repair-heartline-3.4.ps1, repair-heartline-3.4.sh, REPAIR_INSTRUCTIONS.txt -Force -ErrorAction SilentlyContinue
npm run verify-repository
if ($LASTEXITCODE -ne 0) { throw "repository completeness check failed" }
npm test
if ($LASTEXITCODE -ne 0) { throw "npm test failed" }
npm run check
if ($LASTEXITCODE -ne 0) { throw "npm run check failed" }
Write-Host "Validation passed. Review git status, then git add -A / commit / push." -ForegroundColor Green
git status --short
