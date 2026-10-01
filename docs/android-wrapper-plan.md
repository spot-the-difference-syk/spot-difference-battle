# Android wrapper 단계별 작업 계획

## 목표

현재 정상 동작하는 Apps in Toss 게임에 영향을 주지 않고 동일한 React/Vite 게임을 Android APK로 실행한다.

## Phase 1 — 환경 고정 및 문서화

- Android 버전 조합 확정
- Android wrapper 위치 확정
- 보안/서버 연결 원칙 확정
- AIT 회귀 검증 순서 확정

문서: `docs/android-build-environment.md`

## Phase 2 — 최소 Android wrapper 추가

새로 추가할 파일:

```text
apps/android/
├─ settings.gradle.kts
├─ build.gradle.kts
├─ gradle.properties
├─ gradle/wrapper/gradle-wrapper.properties
├─ gradlew
├─ gradlew.bat
└─ app/
   ├─ build.gradle.kts
   └─ src/main/
      ├─ AndroidManifest.xml
      └─ java/.../MainActivity.kt
```

wrapper 역할만 수행하며 게임 소스는 복제하지 않는다.

## Phase 3 — 웹 산출물 복사

`apps/web/dist`를 Android assets에 복사하는 전용 스크립트를 추가한다.

게임 코드는 수정하지 않는다.

Android 빌드 전용 환경변수로 production Worker 주소를 주입할 수 있도록 한다.

## Phase 4 — 기존 AIT 회귀 검증

Android wrapper를 추가한 상태에서 기존 AIT workflow와 동일한 검증을 수행한다.

- type check
- test
- E2E
- Worker bundle build
- AIT build
- AIT 파일 존재 확인

실패하면 APK 작업보다 AIT 정상 상태 복구를 우선한다.

## Phase 5 — debug APK 빌드

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

생성 여부를 확인한다.

## Phase 6 — 실제 게임 접속 테스트

실기기 APK에서 아래를 확인한다.

- 앱 실행
- localStorage 저장
- Worker 연결
- WebSocket 연결
- 1:1 매칭
- 퍼즐 preload
- R2 이미지
- 정답/오답 판정
- 점수
- 결과 저장

## Phase 7 — AIT 재검증 후 merge 판단

APK 기능 성공만으로 merge하지 않는다.

AIT 빌드와 실제 QR 테스트가 그대로 동작하는지 확인한 뒤 main 병합 여부를 결정한다.
