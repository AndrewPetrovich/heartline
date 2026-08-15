#!/usr/bin/env bash
set -euo pipefail
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "Run from the HEARTLINE repository root" >&2; exit 1; fi
rm -f repair-heartline-3.4.ps1 repair-heartline-3.4.sh REPAIR_INSTRUCTIONS.txt
npm run verify-repository
npm test
npm run check
echo "Validation passed. Review git status, then git add -A / commit / push."
git status --short
