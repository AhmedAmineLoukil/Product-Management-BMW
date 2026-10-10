# Removes index entries only; preserves local files and history. No push or commit.
$trackedPrivatePaths = @(git ls-files -- data)
if ($trackedPrivatePaths.Count -gt 0) {
    git rm --cached --ignore-unmatch -- $trackedPrivatePaths
    if ($LASTEXITCODE -ne 0) { throw 'Untracking failed; review Git index locally.' }
}
