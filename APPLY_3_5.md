# Apply HEARTLINE 3.5

Base expected on GitHub: `fa289737b47f12bab5190229f789413d53055d70` or a descendant containing HEARTLINE 3.4 Project Core.

**Do not clear the repository before applying this package.** This ZIP contains only files that are new or changed by 3.5. Existing Reader, Graph, parser, assets, built-in novels and icons must remain in place.

Recommended local Git flow:

```bash
git checkout main
git pull
# extract this update ZIP over the repository root, overwriting matching files
rm -f repair-heartline-3.4.ps1 repair-heartline-3.4.sh REPAIR_INSTRUCTIONS.txt
npm test
npm run check
git status
git add -A
git commit -m "HEARTLINE 3.5 proofreading workspace"
git push
```

If uploading through the GitHub web UI, upload/replace only the files contained in the package and delete only the three files listed in `DELETE_THESE_FILES_3_5.txt`. Do not delete other repository files.

After copying, `npm run verify-repository` checks that the old Reader/Graph/runtime files are still present. This check exists specifically to prevent an update package from accidentally replacing the repository with only the changed files.
