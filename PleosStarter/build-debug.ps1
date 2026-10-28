$ErrorActionPreference = 'Stop'
$pleosJdkRoot = Join-Path $PSScriptRoot '..\.tools\java17'
$pleosJdk = Get-ChildItem -LiteralPath $pleosJdkRoot -Directory | Select-Object -First 1
if (-not $pleosJdk) { throw 'Java 17 is missing. Configure a Java 17 JAVA_HOME.' }
$env:JAVA_HOME = $pleosJdk.FullName
& (Join-Path $PSScriptRoot 'gradlew.bat') -p $PSScriptRoot assembleDebug
exit $LASTEXITCODE
