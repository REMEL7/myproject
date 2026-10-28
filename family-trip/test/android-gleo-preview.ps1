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
function Invoke-Gleo([string]$action,[string]$expected){
    & $adb -s emulator-5554 shell am start -W -n "$package/.GleoContractTestActivity" --es invokeAction $action | Out-Null
    if($LASTEXITCODE -ne 0){throw "Gleo invocation failed: $action"}
    $doc=Screen-Xml
    $qaPid=(& $adb -s emulator-5554 shell pidof $package).Trim()
    $logs=& $adb -s emulator-5554 logcat -d --pid=$qaPid -s MoagilGleo:I '*:S'
    $result=$logs | Select-String "action=$action status=$expected callbackDispatched=true" | Select-Object -Last 1
    if(-not $result){throw "Expected Gleo response missing: $action / $expected"}
    Write-Host "PASS $action -> $expected (targeted Gleo callback dispatched)"
    return $doc
}
try{
    & $adb -s emulator-5554 push "$workspace/family-trip/data/qa-prefs.xml" /data/local/tmp/moagil-qa-prefs.xml | Out-Null
    & $adb -s emulator-5554 shell run-as $package --user 10 cp /data/local/tmp/moagil-qa-prefs.xml shared_prefs/family-trip.xml
    if($LASTEXITCODE -ne 0){throw 'QA staging failed'}
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
    $doc=Screen-Xml
    if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '[개발검증] 친구들과 나들이'})){throw 'QA room not visible'}
    $doc=Invoke-Gleo 'SHOW_MOAGIL_COURSE' 'success'
    if(-not($doc.SelectNodes('//node') | Where-Object {$_.text -eq '저장한 코스 이어가기'})){throw 'Course UI missing'}
    Capture 'gleo-saved-course.png'
    [void](Invoke-Gleo 'RESUME_MOAGIL_COURSE' 'asking')
    $snapshot=Invoke-RestMethod -Uri $base -Headers $headers
    if($snapshot.ballot.status -eq 'closed'){[void](Call-Fixture 'ballot' @{action='clear'})}
    $snapshot=Invoke-RestMethod -Uri $base -Headers $headers
    if(-not $snapshot.ballot){[void](Call-Fixture 'ballot' @{action='open'})}
    [void](Invoke-Gleo 'GET_MOAGIL_VOTE_RESULT' 'asking')
    Capture 'gleo-secret-vote.png'
    # A dead local address plus a cached room must never return stale ballot results.
    & $adb -s emulator-5554 shell am force-stop $package
    $prefs.SelectSingleNode("/map/string[@name='serverUrl']").InnerText='http://127.0.0.1:1'
    $prefs.Save("$workspace/family-trip/data/qa-prefs.xml")
    & $adb -s emulator-5554 push "$workspace/family-trip/data/qa-prefs.xml" /data/local/tmp/moagil-qa-prefs.xml | Out-Null
    & $adb -s emulator-5554 shell run-as $package --user 10 cp /data/local/tmp/moagil-qa-prefs.xml shared_prefs/family-trip.xml
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
    [void](Invoke-Gleo 'SHOW_MOAGIL_COURSE' 'fail')
}finally{
    & $adb -s emulator-5554 shell am force-stop $package
    & $adb -s emulator-5554 shell run-as $package --user 10 cp shared_prefs/family-trip.qa-backup.xml shared_prefs/family-trip.xml
    if($LASTEXITCODE -ne 0){throw 'Original preferences restore failed'}
    & $adb -s emulator-5554 shell am start -n "$package/.FamilyTripActivity" | Out-Null
    Write-Output 'Original app room preferences restored; no navigation request was made.'
}


