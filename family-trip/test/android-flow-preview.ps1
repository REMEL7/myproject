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
    while($node.'clickable' -ne 'true' -and $node.ParentNode.Name -eq 'node'){$node=$node.ParentNode}
    if($node.bounds -notmatch '\[(\d+),(\d+)\]\[(\d+),(\d+)\]'){throw 'Invalid UI bounds'}
    $x=[int](([int]$matches[1]+[int]$matches[3])/2);$y=[int](([int]$matches[2]+[int]$matches[4])/2)
    & $adb -s emulator-5554 shell input tap $x $y; Start-Sleep -Milliseconds 450
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
function Tap-Description([string]$description){
 $doc=Screen-Xml;$node=$doc.SelectNodes('//node') | Where-Object {$_.'content-desc' -eq $description} | Select-Object -First 1
 if(-not $node -or $node.bounds -notmatch '\[(\d+),(\d+)\]\[(\d+),(\d+)\]'){Capture 'ux-flow-diagnostic.png';throw "Missing UI description: $description"}
 $x=[int](([int]$matches[1]+[int]$matches[3])/2);$y=[int](([int]$matches[2]+[int]$matches[4])/2);& $adb -s emulator-5554 shell input tap $x $y; Start-Sleep -Milliseconds 450
}
try{
 & $adb -s emulator-5554 push "$workspace/family-trip/data/qa-prefs.xml" /data/local/tmp/moagil-qa-prefs.xml | Out-Null
 & $adb -s emulator-5554 shell run-as $package --user 10 cp /data/local/tmp/moagil-qa-prefs.xml shared_prefs/family-trip.xml
 & $adb -s emulator-5554 shell am start -W -n "$package/.FamilyTripActivity" | Out-Null
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq 'GMG'})){throw 'QA room missing'}
 if($doc.SelectNodes('//node') | Where-Object {$_.text -eq '투표가 끝났어요'}){throw 'Closed ballot replaced home'}
 Capture 'ux-home-choose.png' 
 Tap-Text '홈'
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '장소 둘러보기'})){throw 'Home entry missing'}
 Capture 'ux-home-trip.png'
 Tap-Text '코스'
 Tap-Text '코스 만들기'
 $doc=Screen-Xml
 if($doc.SelectNodes('//node') | Where-Object {$_.text -eq '출발 좌표 직접 입력'}){throw 'Advanced coordinates shown by default'}
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '출발 위치 바꾸기'})){throw 'Departure picker missing'}
 Capture 'ux-simple-course.png'
 Tap-Text '출발 위치 바꾸기'
 Tap-Text '[검증] 식사 장소'
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '[검증] 식사 장소'})){throw 'Departure place did not update'}
 Tap-Text '세부 설정 보기'
 $doc=Screen-Xml
 if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '출발 좌표 직접 입력'})){throw 'Advanced options did not expand'}
 Tap-Text '취소'

 Tap-Text '장소'
 Tap-Description '[검증] 식사 장소 관리 메뉴'
 Capture 'ux-place-menu.png'
 Tap-Text '방문 일정 설정'
 Tap-Text '여유 2시간'
 Tap-Text '저장'
 $doc=Screen-Xml
 $r=Invoke-RestMethod -Uri $base -Headers $headers
 if(($r.places | Where-Object {$_.id -eq $fixture.placeIds[0]}).stayMinutes -ne 120){throw 'Preset did not save 120 minutes'}
 Write-Output 'PASS simple home / course form / place menu / duration preset'
 Tap-Text '홈'
 Capture 'ux-home-final.png'
}finally{
 & $adb -s emulator-5554 shell am force-stop $package
 & $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.qa-backup.xml shared_prefs/family-trip.xml
 if($LASTEXITCODE -ne 0){throw 'Original settings restore failed'}
 & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
 Write-Output 'Original app room preferences restored.'
}



