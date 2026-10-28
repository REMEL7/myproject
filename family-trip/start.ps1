param([string]$BindAddress='127.0.0.1',[string]$PublicUrl='')
$ErrorActionPreference='Stop'
$moagilNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $moagilNode) { throw 'Node.js is required.' }
$env:HOST=$BindAddress
$env:PUBLIC_URL=$PublicUrl
& $moagilNode (Join-Path $PSScriptRoot 'server.mjs')
