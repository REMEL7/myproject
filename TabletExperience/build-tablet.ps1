param([string]$ServerUrl='')
$ErrorActionPreference='Stop'
$jdk=Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '../.tools/java17') -Directory | Select-Object -First 1
if(-not $jdk){throw 'Java 17 missing'}
$env:JAVA_HOME=$jdk.FullName
& (Join-Path $PSScriptRoot 'gradlew.bat') -p $PSScriptRoot assembleDebug "-PtabletServerUrl=$ServerUrl"
exit $LASTEXITCODE
