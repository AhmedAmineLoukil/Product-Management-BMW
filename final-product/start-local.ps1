param([ValidateRange(1024, 65535)][int]$Port = 5173)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$portableNode = Join-Path (Split-Path $PSScriptRoot -Parent) '.tools/node-v22.22.0-win-x64/node.exe'
if ($nodeCommand) { $node = $nodeCommand.Source }
elseif (Test-Path -LiteralPath $portableNode) { $node = $portableNode }
else { throw 'Install Node.js 22 or newer, then run this script again.' }
$env:PATH = "$(Split-Path $node -Parent);$env:PATH"
$npm = Join-Path (Split-Path $node -Parent) 'npm.cmd'
if (!(Test-Path -LiteralPath 'node_modules/.package-lock.json')) {
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Node dependency installation failed.' }
}

$pythonCandidates = @(
    (Join-Path $PSScriptRoot '.venv/Scripts/python.exe'),
    (Join-Path (Split-Path $PSScriptRoot -Parent) '.venv/Scripts/python.exe')
)
$python = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$python) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (!$pythonCommand) { throw 'Install Python 3.10 or newer, then run this script again.' }
    & $pythonCommand.Source -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
    $python = $pythonCandidates[0]
}
& $python -c 'import openai, pydantic, requests, bs4, pandas, openpyxl, fitz, dotenv'
if ($LASTEXITCODE -ne 0) {
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
}
$env:PYTHON_BIN = $python
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONUTF8 = '1'
Write-Host "Open http://127.0.0.1:$Port/ . Press Ctrl+C to stop."
& $node node_modules/vite/bin/vite.js --configLoader runner --host 127.0.0.1 --port $Port --strictPort
exit $LASTEXITCODE
