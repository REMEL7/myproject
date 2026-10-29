# GMG Android 앱

Pleos Connect에서 실행하는 Kotlin Activity 앱입니다. 친구·가족·동료가 휴대폰에서 모은 장소를 차량에서 확인하고 목적지 또는 코스로 정한 뒤 기본 내비로 보냅니다.

## 환경

- Java 17, Kotlin 2.2.10.
- Gradle Wrapper 9.6.0, Android Gradle Plugin 9.4.1.
- compileSdk 36, targetSdk 34, minSdk 28.
- Vehicle 2.3.2, NaviHelper 3.0.5, ZXing 3.5.3.
- Pleos Connect 에뮬레이터 v2.1.0에서 개발·검증.

## 실행

1. Android Studio에서 이 폴더를 엽니다.
2. Java 17과 Android SDK 경로를 설정합니다. `local.properties`는 각 환경에서 생성합니다.
3. Gradle Sync 후 Pleos Connect 에뮬레이터에 `app`을 실행합니다.
4. [공유 서버](../family-trip/README.md)를 PC에서 실행합니다.

기본 실행 화면은 `FamilyTripActivity`입니다. 기본 서버 주소는 `http://10.0.2.2:8787`이고 고급 설정에서 바꿀 수 있습니다.

```powershell
.\gradlew.bat assembleDebug
```

상위 `.tools/java17`에 로컬 Java를 준비한 환경에서는 `build-debug.ps1`도 사용할 수 있습니다. 해당 개발 도구 폴더는 Git에 포함하지 않습니다.

## 주요 화면

- 홈: 앱 이름과 간단한 시작 안내.
- 장소: 목록·상세 정보·이름과 메모 수정·삭제·되돌리기·출발 확인.
- 코스: 방문 순서 비교·저장·이어가기·방문 완료·일정 관리.

화면 크기에 따라 목록이 재배치되며 분할 화면을 지원합니다. 차량의 주행 제한 상태를 확인하고 주차 상태에서만 조작할 수 있습니다. 상태를 확인할 수 없으면 조작을 제한합니다. 실제 안내 시작은 사용자 확인을 거쳐 Pleos 기본 내비에 전달합니다.

완료된 코스에 속한 장소도 목록에서 삭제할 수 있으며, 완료 기록은 유지합니다. 진행 중인 코스의 남은 장소를 삭제하면 다시 계산이 필요하다고 표시하고 오래된 도착 계획으로 출발하지 않도록 합니다.

## Virtual Console

`start-virtual-console.ps1`은 설정한 Pleos AVD를 찾아 실행하고, 콘솔의 8088 포트를 전달한 뒤 브라우저를 엽니다. SDK 경로나 AVD 이름이 다르면 인자로 지정합니다. Android Studio를 별도로 시작하지 않습니다.

## 개발용 구성

`MainActivity`의 차량 SDK 예제와 오버레이·위젯 실험 코드를 조사 목적으로 보존합니다. 현재 제품의 기본 화면은 GMG이며, 내비 위 실제 오버레이 표시를 완료한 기능으로 안내하지 않습니다.

글레오 스키마와 액션은 개발 단계입니다. 실제 음성 호출은 등록·승인과 지원 기기 검증이 필요합니다.

## Release

`MOAGIL_SERVER_URL`에 HTTPS origin을 지정하고 다음 서명 환경 변수를 준비해야 합니다.

- `MOAGIL_KEYSTORE`
- `MOAGIL_STORE_PASSWORD`
- `MOAGIL_KEY_ALIAS`
- `MOAGIL_KEY_PASSWORD`

서명 파일과 값은 Git에 올리지 않습니다. 운영용 서버와 인증·배포 구성은 별도 준비가 필요합니다.

### 장소 선택 접근성 개선
출발·삭제·관리·수정·방문 조건은 애니메이션 없는 중앙 팝업으로 표시하며, 주요 확인 버튼은 높이 72 앱 단위를 사용합니다. 즐겨찾기 UI는 제거했습니다. 분류는 맛집(🍚), 카페(☕), 가볼 곳(🏞️), 숙소(🏨), 기타(📍)이며 알 수 없거나 비어 있는 분류도 기타로 표시합니다. 좁은 창에서도 팝업이 창 안에 맞춰집니다.
