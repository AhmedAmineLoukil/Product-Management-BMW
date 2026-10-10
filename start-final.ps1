param([ValidateRange(1024, 65535)][int]$Port = 5173)
& (Join-Path $PSScriptRoot 'final-product/start-local.ps1') -Port $Port
exit $LASTEXITCODE
