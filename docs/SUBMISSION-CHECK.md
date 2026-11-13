# GMG 최종 제출 점검

점검일: 2026년 11월 13일. APK 소스 기준 커밋은 `e8cd404cca13696be4d5c77781925938d18b9aba`입니다. APK와 안내 자료를 추가한 제출 커밋은 접수 메일에 별도로 기재합니다.

| 항목 | 확인 결과 |
| --- | --- |
| release 빌드 | `assembleSubmissionRelease` 성공. Android Lint Vital 검사 포함 |
| APK 서명 | APK Signature Scheme v2 검증 성공, RSA 3072-bit |
| 디버깅 | `run-as` 접근 거부로 디버깅 비활성 확인. debug 전용 검사·오버레이 Activity 미포함 확인 |
| 실제 기기 환경 | Pleos Connect v2.1.0, Android Automotive x86_64, 2560×1440 px / 160 dpi |
| 설치와 실행 | 에뮬레이터 사용자 10에 설치·업데이트 성공. 앱 Activity 정상 시작 |
| 실제 앱 흐름 | 장소 세 곳 표시, 장소 선택 → 주차·비용 → 출발지 → 세 기준 코스 비교 → 저장 성공 |
| 재실행 | 앱 강제 종료 후 재실행 시 저장 코스 복원 확인 |
| 삭제 | 코스 삭제 확인창 및 삭제 후 코스 만들기 화면 복귀 확인 |
| 내비 | 다음 장소를 내비로 전달하기 전 목적지 확인 화면까지 확인. 실제 도로 주행 검증과 구분 |
| 서버 검사 | 예시 모임 격리 검사와 기존 기능 검사 포함 42개 통과 |
| production 보호 | 일반 production release는 HTTPS 설정 없이 빌드 실패함을 확인 |
| 기존 앱 빌드 | `assembleProductionDebug` 성공. 기존 앱을 지우거나 데이터를 초기화하지 않음 |
| 비공개 정보 | 공개 대상 소스와 APK에서 실제 API 키 미검출. 서명키·환경 파일·개인 문서·모임 기록 제외 |
| README | 앱 소개·실행 방법·환경·에뮬레이터 버전·화면 규격·APK 위치 기재 |
| 공개 파일 재검사 | 업로드 후 APK·영상·실행 안내의 공개 접근 및 APK 해시 확인 예정 |

## 심사 실행 범위

심사용 release APK와 별도 PC 서버를 함께 실행하는 구성입니다. 예시 서버의 장소는 가상 자료이며, 실제 지도·주차·도로시간·관광정보 조회에는 심사 환경의 API 키 설정이 필요합니다. 외부 API 미연결 상태의 도로시간과 비용은 미확인으로 표시합니다. 자동 영업시간 반영과 글레오 실제 음성 호출은 완료된 기능으로 안내하지 않습니다.

설정·제약·실행 명령은 [심사용 실행 안내](SUBMISSION.md), 데이터 출처와 비용 계산 범위는 [DATA_SOURCES.md](../DATA_SOURCES.md)에 있습니다.

## 이메일 제출

- 필수 첨부: 참가신청서·기획서·팀원 서명 페이지가 포함된 Word 파일.
- 참조(CC): 대표자를 제외한 모든 팀원의 이메일.
- 본문: 저장소 URL과 최종 제출 커밋 번호. 대표 소개 영상·상세 시연 영상·APK 경로도 함께 기재합니다.
- APK는 저장소의 `apk/GMG팀_GMG_release.apk`에 포함합니다. 개별 APK만 단독으로 제출하는 방식과 구분합니다.
- 개인 서명과 연락처가 들어 있는 Word 파일은 공개 GitHub에 올리지 않습니다.

공식 기준: [지원·제출 방법](https://appdevchallenge.auto-hmg.io/guide/submission), [FAQ](https://appdevchallenge.auto-hmg.io/faq).
