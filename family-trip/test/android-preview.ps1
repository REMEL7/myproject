$ErrorActionPreference='Stop'
$adb='C:/Users/hyeon/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$package='com.example.pleosstarter'
$workspace='D:/ChatGPT/현대자동차_플레오스'
$fixture=Get-Content -LiteralPath "$workspace/family-trip/data/ui-preview.json" -Raw | ConvertFrom-Json
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
    if($LASTEXITCODE -ne 0){throw 'QA preference staging failed'}
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null

    $doc=Screen-Xml
    $isFixture=@($doc.SelectNodes('//node') | Where-Object {$_.text -eq '[개발검증] 친구들과 나들이'}).Count -gt 0
    if(-not $isFixture){throw 'QA room not visible; restoring original preferences'}
    Tap-Text '함께 추천'
    Capture 'group-named-votes.png'
    Tap-Text '여행 코스'
    $doc=Screen-Xml
    $saved=@($doc.SelectNodes('//node') | Where-Object {$_.text -eq '저장한 코스 이어가기'}).Count -gt 0
    Capture 'group-saved-course.png'
    & $adb -s emulator-5554 shell am force-stop $package
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null

    Tap-Text '여행 코스'
    $doc=Screen-Xml
    $resumed=@($doc.SelectNodes('//node') | Where-Object {$_.text -match '1/3곳 진행'}).Count -gt 0
    Write-Output "Saved course UI: $saved; restored after app restart: $resumed"
    $snapshot=Invoke-RestMethod -Uri $base -Headers $headers
    if(-not $snapshot.ballot){[void](Call-Fixture 'ballot' @{action='open'})}
    [void](Call-Fixture 'ballot' @{action='cast';placeId=$fixture.placeIds[0];voter='native-qa-participant-1';name='민수'})
    [void](Call-Fixture 'ballot' @{action='cast';placeId=$fixture.placeIds[0];voter='native-qa-participant-2';name='지우'})
    Tap-Text '한 곳 결정'
    $doc=Screen-Xml
    Capture 'group-secret-ballot.png'
    Tap-Text '투표 종료하고 결과 준비'
    Tap-Text '종료'
    Tap-Text '결과 공개'
    Start-Sleep -Seconds 2
    $doc=Screen-Xml
    $winner=@($doc.SelectNodes('//node') | Where-Object {$_.text -like '*오늘은 여기로*'}).Count -gt 0
    Write-Output "Native result reveal visible: $winner"
    Capture 'group-native-reveal.png'
}finally{
    & $adb -s emulator-5554 shell am force-stop $package
    & $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.qa-backup.xml shared_prefs/family-trip.xml
    if($LASTEXITCODE -ne 0){throw 'Restore failed: private backup retained at shared_prefs/family-trip.qa-backup.xml'}
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
    Write-Output 'Original app room preferences restored.'
}


