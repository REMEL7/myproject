# GMG 심사용 실행 안내

## 제출 APK와 환경

- APK: [`apk/GMG팀_GMG_release.apk`](../apk/GMG팀_GMG_release.apk)
- 앱 이름: GMG 심사용. 패키지: `com.example.pleosstarter.submission`.
- 서명된 `submissionRelease` 빌드이며 `debuggable=false`입니다. 기존 차량 앱과 설치·데이터가 분리됩니다.
- Pleos Connect 에뮬레이터 **v2.1.0**, Android Automotive x86_64에서 검증했습니다.
- 에뮬레이터 전체 화면은 **2560×1440 px**, 밀도 **160 dpi**입니다. 앱은 차량 화면 일부에서 실행되며 분할 화면을 지원합니다.
- 공유 서버: **Node.js 22 이상**. 외부 npm 패키지 설치는 필요하지 않습니다.

이 APK는 공모전 에뮬레이터 심사용 빌드입니다. 상용 서비스 배포판이 아니며, 서버를 실행할 PC가 필요합니다. 실제 차량 출시는 HTTPS 서버·운영 구성과 추가 기기 검증이 필요합니다.

## API 키 없이 기본 흐름 확인

1. 저장소를 내려받고 Pleos Connect 에뮬레이터를 켭니다.
2. PC 터미널에서 다음 명령을 실행하고 서버를 켜 둡니다.

```sh
cd family-trip
node review-server.mjs
```

3. 다른 터미널에서 APK를 설치하고 엽니다. `adb`는 Android SDK platform-tools의 실행 파일입니다.

```sh
adb install -r "apk/GMG팀_GMG_release.apk"
adb shell am start --user 10 -n com.example.pleosstarter.submission/com.example.pleosstarter.FamilyTripActivity
```

위 설치 명령은 저장소 최상위 폴더 기준입니다. 활성 Android 사용자가 10이 아니라면 `adb shell am get-current-user`로 확인한 값을 사용합니다. 설치 후 런처의 **GMG 심사용** 아이콘으로도 열 수 있습니다.

4. 앱의 설정 → 여행방 연결 설정에 기본값 `http://10.0.2.2:8787`이 표시됩니다. 이 주소는 에뮬레이터에서 PC로 연결하는 전용 주소입니다.
5. `[예시]` 장소 세 곳으로 장소 확인·삭제·코스 비교·저장·방문 이어가기를 확인합니다. 주차는 선택하지 않고 관람료는 직접 입력할 수 있습니다.

예시 장소는 **가상 자료**이며 실제 영업정보나 실시간 요금이 아닙니다. 도로 API가 연결되지 않으면 도로시간을 미확인으로 표시하고 직선 동선으로 비교합니다. 미확인 요금은 무료로 처리하지 않습니다. 예시 서버는 PC 내부에서만 수신하고 휴대폰 외부 QR 공유를 활성화하지 않습니다. 예시 기록은 `family-trip/data/review/`에 별도로 저장됩니다.

포트 8787을 다른 GMG 서버가 사용 중이면 둘 중 하나만 실행해야 합니다. 기존 서버와 데이터를 삭제할 필요는 없습니다.

## 실제 지도와 장소 정보 사용

1. 예시 서버를 종료합니다.
2. `family-trip/.env.example`을 `.env`로 복사해 본인에게 발급된 카카오·관광·주차 API 키를 설정합니다.
3. `family-trip`에서 `node server.mjs`를 실행합니다. 실제 모임은 `family-trip/data/rooms.json`에 별도로 저장됩니다.
4. 웹 지도는 `http://localhost:8787`에서 확인합니다. 카카오 JavaScript 키에는 사용할 웹 도메인을 등록해야 합니다.

키가 필요한 외부 API를 심사 APK에 내장하지 않았습니다. 키와 서명키, 개인 모임 기록은 공개 저장소에 포함하지 않습니다. 휴대폰 QR 공유는 [서버 안내](../family-trip/README.md)의 명시적 네트워크 설정이 추가로 필요합니다.

심사용 release의 HTTP 예외는 **에뮬레이터 주소 `10.0.2.2:8787`에만** 적용됩니다. 임의의 PC IP·공인 IP HTTP 주소로 바꿔도 허용되지 않습니다. 다른 서버는 유효한 HTTPS 주소를 사용해야 합니다. 일반 production release는 HTTPS 전용 검증을 유지합니다.

## 확인할 기능

1. 장소 선택: 상세 정보, 수정, 삭제와 되돌리기.
2. 코스: 장소 선택 → 주차·비용 → 시간·거리·비용 비교 → 저장.
3. 방문: 도착 확인 → 방문 완료 → 다음 장소 확인. 앱을 다시 켜도 진행 상태 유지.
4. 출발: 사용자가 목적지를 확인한 뒤 Pleos 기본 내비로 전달. 실제 도로 주행 검증은 별도입니다.
5. 차량 조작은 주차 상태에서만 허용합니다. 차량 상태를 확인할 수 없으면 조작을 제한합니다.

자동 영업시간 반영과 글레오의 실제 음성 호출은 완료된 기능이 아닙니다. 데이터 출처·비용 계산 범위는 [DATA_SOURCES.md](../DATA_SOURCES.md)를 참고하세요.

## 소스에서 다시 빌드

일반 개발 빌드는 `PleosStarter/gradlew.bat -p PleosStarter assembleProductionDebug`입니다.

심사용 release는 본인 서명키로 `MOAGIL_KEYSTORE`, `MOAGIL_STORE_PASSWORD`, `MOAGIL_KEY_ALIAS`, `MOAGIL_KEY_PASSWORD`를 설정한 뒤 다음 명령을 실행합니다.

```sh
PleosStarter/gradlew.bat -p PleosStarter assembleSubmissionRelease
```

Java 17과 Android SDK 36이 필요합니다. production release는 위 서명 설정 외에 유효한 `MOAGIL_SERVER_URL` HTTPS origin도 필요합니다.
