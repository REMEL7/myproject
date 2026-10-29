$ErrorActionPreference='Stop'
$adb='C:/Users/hyeon/AppData/Local/Android/Sdk/platform-tools/adb.exe'
$package='com.example.pleosstarter'
$workspace='D:/ChatGPT/현대자동차_플레오스'
$fixture=Get-Content -LiteralPath "$workspace/family-trip/data/delete-preview.json" -Raw | ConvertFrom-Json
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
function Tap-PlaceMenu {
 $screen=Screen-Xml;$node=$screen.SelectNodes('//node') | Where-Object {$_.'content-desc' -eq '삭제 기능 검증 장소 관리 메뉴'} | Select-Object -First 1
 if(-not $node -or $node.bounds -notmatch '\[(\d+),(\d+)\]\[(\d+),(\d+)\]'){throw 'Place menu missing'}
 $x=[int](([int]$matches[1]+[int]$matches[3])/2);$y=[int](([int]$matches[2]+[int]$matches[4])/2);& $adb -s emulator-5554 shell input tap $x $y
}
try{
    & $adb -s emulator-5554 push "$workspace/family-trip/data/qa-prefs.xml" /data/local/tmp/moagil-qa-prefs.xml | Out-Null
    & $adb -s emulator-5554 shell run-as $package --user 10 cp /data/local/tmp/moagil-qa-prefs.xml shared_prefs/family-trip.xml
    if($LASTEXITCODE -ne 0){throw 'QA preference staging failed'}
    & $adb -s emulator-5554 shell am start -W -n "$package/.FamilyTripActivity" | Out-Null
    $doc=Screen-Xml
    if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq 'GMG'})){throw 'QA room not visible'}
    Tap-Text '장소'
    Tap-PlaceMenu
    Tap-Text '이 장소 삭제'
    Capture 'place-delete-confirm.png'
    Tap-Text '취소'
    $stillPresent=Invoke-RestMethod -Uri $base -Headers $headers
    if($stillPresent.places.Count -ne 1){throw 'Cancel unexpectedly changed the place list'}
    Tap-PlaceMenu
    Tap-Text '이 장소 삭제'
    Tap-Text '삭제'
    $doc=Screen-Xml
    $removed=Invoke-RestMethod -Uri $base -Headers $headers
    if($removed.places.Count -ne 0 -or -not $removed.canUndoPlaceDelete){throw 'Delete did not persist'}
    Capture 'place-delete-empty.png'
    Tap-Text '되돌리기'
    $doc=Screen-Xml
    $restored=Invoke-RestMethod -Uri $base -Headers $headers
    if($restored.places.Count -ne 1 -or $restored.places[0].votes -ne 1){throw 'Restore lost the place or its vote'}
    Capture 'place-delete-restored.png'
    Write-Output 'PASS native cancel / delete / inline undo preserves original interest'
}finally{
    & $adb -s emulator-5554 shell am force-stop $package
    & $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.qa-backup.xml shared_prefs/family-trip.xml
    if($LASTEXITCODE -ne 0){throw 'Original preferences restore failed'}
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
    Write-Output 'Original app room preferences restored.'
}

