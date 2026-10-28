param([string]$SdkRoot="$env:LOCALAPPDATA/Android/Sdk",[string]$AvdName='Pleos_Connect_v2.1.0')
$ErrorActionPreference='Stop'
$adb=Join-Path $SdkRoot 'platform-tools/adb.exe'
$emulator=Join-Path $SdkRoot 'emulator/emulator.exe'
if(-not(Test-Path -LiteralPath $adb)){throw 'Android SDK platform-tools not found'}
function Find-TargetAvd {
 foreach($line in (& $adb devices | Select-String '^emulator-\d+\s+device$')){
  $candidate=$line.ToString().Split()[0]
  $name=(& $adb -s $candidate emu avd name | Select-Object -First 1)
  if($name -eq $AvdName){return $candidate}
 }
}
$serial=Find-TargetAvd
if(-not $serial){Start-Process -FilePath $emulator -ArgumentList @('-avd',$AvdName,'-no-snapshot-load','-no-boot-anim')}
$ready=$false
for($attempt=0;$attempt -lt 60;$attempt++){
 $serial=Find-TargetAvd
 if($serial -and (& $adb -s $serial shell getprop sys.boot_completed) -eq '1'){$ready=$true;break}
 Start-Sleep -Seconds 2
}
if(-not $ready){throw 'Emulator did not finish booting'}
& $adb -s $serial forward tcp:8088 tcp:8088
if($LASTEXITCODE -ne 0){throw 'Console port forwarding failed'}
Invoke-WebRequest 'http://127.0.0.1:8088/' -UseBasicParsing -TimeoutSec 10 | Out-Null
Start-Process 'http://127.0.0.1:8088/'
Write-Output 'Virtual Console: Emulation Controls > Climate. Android Studio is not started.'
