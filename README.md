# 모아길 · Moagil

함께 갈 장소를 모으고 투표로 정한 뒤, 차량 내비게이션으로 안내받는 Pleos Connect 앱 개발 프로젝트입니다.

## 구성

- `PleosStarter/`: Kotlin 기반 차량 앱. iOS 느낌의 목록·하단 탭·시트, 장소 관리, 비밀 투표, 코스 저장과 이어가기, Pleos 기본 내비 연동.
- `family-trip/`: Node.js 공유 서버와 휴대폰 웹. QR 참여, 카카오 장소 검색·지도, 관심 표시, 비밀 투표, 코스 계산.

## 개발 환경

- Android: JDK 17, Android SDK 36, Pleos Connect 에뮬레이터.
- SDK: Vehicle 2.3.2, NaviHelper 3.0.5. 공식 Pleos Maven 저장소에서 내려받습니다.
- 서버: Node.js 22 이상 (`loadEnvFile`, 내장 fetch 및 테스트 실행기 사용).

### 공유 서버

1. `family-trip/.env.example`을 `family-trip/.env`로 복사하고 사용할 카카오 키를 입력합니다.
2. `family-trip` 폴더에서 `node server.mjs`를 실행합니다.
3. PC 웹은 `http://localhost:8787`, 에뮬레이터는 `http://10.0.2.2:8787`로 연결합니다.

기본 서버는 PC 내부에서만 접속할 수 있습니다. 휴대폰 QR 접속은 해당 네트워크의 수신 주소와 PUBLIC_URL을 별도로 설정해야 합니다. 임시 외부 수신은 30분 뒤 자동 종료됩니다. 설정 방법은 [서버 안내](family-trip/README.md)를 참고하세요.

### Android 앱

1. Android Studio에서 `PleosStarter`를 엽니다.
2. 로컬 Android SDK 경로를 설정하고 Gradle 의존성을 받습니다.
3. Pleos Connect 에뮬레이터에서 `app`을 실행합니다.

명령줄에서는 JDK 17을 JAVA_HOME으로 설정한 뒤 `PleosStarter/gradlew.bat -p PleosStarter assembleDebug`로 빌드할 수 있습니다. 개발용 앱은 로컬 HTTP 서버에 연결하며, release 빌드는 HTTPS 서버 주소와 별도 서명 환경 변수가 필요합니다.

## 현재 동작과 제한

- 차량 조작은 주차 상태에서만 허용하며, 차량 상태 확인이 안 되면 조작을 제한합니다.
- 하트는 가고 싶은 장소에 대한 관심 표시이고, 비밀 투표는 최종 결정을 위한 별도 한 표입니다.
- 카카오 도로 구간 조회에 성공하면 방문 순서를 도로 예상시간으로 비교합니다. 실패 시 직선 동선·임시 이동시간 사용 여부를 표시합니다.
- 필수 장소와 관심 표시 수를 기준으로 최대 5곳을 고른 뒤 그 장소들의 방문 순서를 비교합니다.
- 운영시간은 현재 직접 입력하는 방식입니다. 자동 영업정보 조회는 아직 연동하지 않았습니다.
- 머무는 시간은 현재 코스 계산에 사용합니다. 제거·변경 여부와 자동 영업정보 연동은 후속 개선 사항입니다.
- 글레오 연결용 스키마와 액션은 개발 중이며, 실제 사용은 등록·승인과 기기 검증이 필요합니다.
- 현재 개발 시제품으로, 실제 차량 검증과 운영 환경 구성은 별도로 진행해야 합니다.

## 검증

`family-trip` 폴더에서 다음 명령을 실행합니다.

```sh
node --test test/server.test.mjs test/session.test.mjs test/brand-contrast.test.mjs
```

Android 화면 검증 스크립트는 `family-trip/test/`에 있습니다. 로컬 에뮬레이터·SDK 경로와 별도 검증 모임 데이터가 필요한 개발용 스크립트입니다.

## 업로드에서 제외한 파일

실제 API 키, 서명 키, 초대 링크·참여자·장소·투표 기록, Android 캐시와 빌드 결과, 다운로드한 개발 도구, QR 화면을 포함한 로컬 검증 자료는 Git에 포함하지 않습니다. 환경 변수 예시는 `.env.example`만 공유합니다.
