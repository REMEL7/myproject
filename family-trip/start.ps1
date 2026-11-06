param([string]$BindAddress='127.0.0.1',[string]$PublicUrl='',[switch]$KeepPhoneSharingOpen)
$ErrorActionPreference='Stop'
$moagilNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $moagilNode) { throw 'Node.js is required.' }
$env:HOST=$BindAddress
$env:PUBLIC_URL=$PublicUrl
$env:PHONE_SHARE_PERSISTENT=if($KeepPhoneSharingOpen){'1'}else{'0'}
& $moagilNode (Join-Path $PSScriptRoot 'server.mjs')
