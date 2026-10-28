$ErrorActionPreference='Stop'
$adb='C:/Users/hyeon/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$package='com.example.pleosstarter'
$workspace='D:/ChatGPT/현대자동차_플레오스'
$fixture=Get-Content -LiteralPath "$workspace/family-trip/data/flow-preview.json" -Raw | ConvertFrom-Json
$base="http://127.0.0.1:8787/api/rooms/$($fixture.id)"
$headers=@{Authorization="Bearer $($fixture.ownerToken)"}
function Call-Fixture($action,$payload){Invoke-RestMethod -Uri "$base/$action" -Method Post -ContentType 'application/json' -Headers $headers -Body ($payload | ConvertTo-Json -Depth 8)}
function Screen-Xml {
    & $adb -s emulator-5554 shell uiautomator dump /sdcard/group-qa.xml | Out-Null
    $lines=& $adb -s emulator-5554 shell cat /sdcard/group-qa.xml
    [xml]($lines -join "`n")
}
function Tap-Text([string]$label){
    $doc=Screen-Xml
    $node=$doc.SelectNodes('//node') | Where-Object {$_.text -eq $label} | Select-Object -First 1
    if(-not $node){throw "UI target missing: $label"}
    if($node.bounds -notmatch '\[(\d+),(\d+)\]\[(\d+),(\d+)\]'){throw 'Invalid UI bounds'}
    $x=[int](([int]$matches[1]+[int]$matches[3])/2);$y=[int](([int]$matches[2]+[int]$matches[4])/2)
    & $adb -s emulator-5554 shell input tap $x $y
}
function Capture([string]$name){& $adb -s emulator-5554 shell screencap -p /sdcard/group-qa.png;& $adb -s emulator-5554 pull /sdcard/group-qa.png "$workspace/research/$name" | Out-Null}
& $adb -s emulator-5554 shell am force-stop $package
$original=& $adb -s emulator-5554 shell run-as $package --user 10 cat shared_prefs/family-trip.xml
if($LASTEXITCODE -ne 0){throw 'Cannot read debug preferences'}
[xml]$prefs=$original -join "`n"
foreach($pair in @(@('roomId',$fixture.id),@('ownerToken',$fixture.ownerToken),@('joinToken',$fixture.joinToken),@('serverUrl','http://10.0.2.2:8787'))){
    $node=$prefs.SelectSingleNode("/map/string[@name='$($pair[0])']")
    if(-not $node){$node=$prefs.CreateElement('string');$node.SetAttribute('name',$pair[0]);[void]$prefs.map.AppendChild($node)}
    $node.InnerText=$pair[1]
}
$cache=$prefs.SelectSingleNode("/map/string[@name='cachedRoom']");if($cache){[void]$prefs.map.RemoveChild($cache)}
$prefs.Save("$workspace/family-trip/data/qa-prefs.xml")
& $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.xml shared_prefs/family-trip.qa-backup.xml
if($LASTEXITCODE -ne 0){throw 'Backup failed'}
try{
 & $adb -s emulator-5554 push "$workspace/family-trip/data/qa-prefs.xml" /data/local/tmp/moagil-qa-prefs.xml | Out-Null
 & $adb -s emulator-5554 shell run-as $package --user 10 cp /data/local/tmp/moagil-qa-prefs.xml shared_prefs/family-trip.xml
 & $adb -s emulator-5554 shell am start -W -n "$package/.FamilyTripActivity" | Out-Null
 $doc=Screen-Xml
 $taskLine=(& $adb -s emulator-5554 shell dumpsys activity activities | Select-String 'Task\{.*#\d+ type=standard A=\d+:com.example.pleosstarter' | Select-Object -First 1).ToString()
 if($taskLine -notmatch '#(\d+)'){throw 'Task ID missing'}
 $taskId=$matches[1]
 & $adb -s emulator-5554 shell am task resize $taskId 853 90 1694 1300
 $doc=Screen-Xml
 $root=$doc.SelectNodes('//node') | Where-Object {$_.package -eq $package} | Select-Object -First 1
 Write-Output "QA app bounds: $($root.bounds)"
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '변경'})){Capture 'ux-split-diagnostic.png';throw 'Mode summary missing'}
 Tap-Text '변경'
 Tap-Text '한 곳 정하기'
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '비밀 투표 시작하기'})){throw 'Vote CTA missing'}
 Tap-Text '변경'
 Tap-Text '여러 곳 둘러보기'
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '여행 코스 만들기'})){throw 'Trip CTA missing'}
 Capture 'ux-home-split-trip.png'
 Write-Output 'PASS narrow-screen mode summary, mode switch and next action'
}finally{
 & $adb -s emulator-5554 shell am force-stop $package
 & $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.qa-backup.xml shared_prefs/family-trip.xml
 if($LASTEXITCODE -ne 0){throw 'Original restore failed'}
 & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
 Write-Output 'Original app room preferences restored.'
}
