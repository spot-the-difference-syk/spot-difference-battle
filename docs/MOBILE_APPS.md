# 모바일 앱(Android·iOS)

> 문서 상태: CURRENT
> 기준일: 2026-10-01

Android·iOS 앱은 웹 게임(`apps/web`)을 앱 안에 넣어 WebView로 실행한다. 게임 코드는 웹·앱인토스와 같다. 앱 안의 화면은 운영 Cloudflare Worker에 접속한다.

| 플랫폼 | 위치 | 방식 | 앱 안 주소(Origin) |
|---|---|---|---|
| Android | `apps/android` | 직접 작성한 WebView 래퍼(Kotlin, `WebViewAssetLoader`) | `https://appassets.androidplatform.net` |
| iOS | `apps/ios` | Capacitor 8 (Swift Package Manager) | `capacitor://localhost` |

## 서버 주소

앱은 다른 주소에서 열리므로 접속할 게임 서버 주소를 빌드할 때 넣는다.

- 기본값: `scripts/production.config.json`의 `gameServerUrl` (현재 `https://spot-difference-game.ssbluegana.workers.dev`)
- 바꾸기: 위 파일 한 줄을 고치거나, 빌드할 때 `VITE_SERVER_URL`을 준다.
- 앱인토스 번들(`pnpm build:ait:cloudflare`)도 같은 기본값을 쓴다.

Worker는 허용된 Origin에서만 WebSocket·`/catalog`를 연다. 위 두 앱 Origin은 `workers/realtime/wrangler.toml`의 `ALLOWED_ORIGINS`에 들어 있다. 앱 방식이나 주소를 바꾸면 이 목록도 함께 고친다.

## 빌드

```powershell
pnpm build:android   # 웹 번들을 만들어 apps/android/app/src/main/assets 로 복사
pnpm build:ios       # 웹 번들을 만들어 iOS 프로젝트에 복사(cap sync)
```

두 명령 모두 Cloudflare 전송(`VITE_GAME_TRANSPORT=cloudflare`)과 위 서버 주소로 웹을 빌드한다. 복사된 웹 번들은 생성물이라 Git에 넣지 않는다.

### Android

- 필요: JDK 17, Android SDK Platform 35, Build Tools 35.0.0. 상세 버전은 `android-build-environment.md`.
- 디버그 APK: `cd apps/android` 후 `./gradlew :app:assembleDebug`(Windows는 `.\gradlew.bat`). Gradle `preBuild`가 `pnpm package:android:web`(= `pnpm build:android`)을 자동 실행한다.
- 결과: `apps/android/app/build/outputs/apk/debug/app-debug.apk`
- 화면: Android 15부터 앱이 시스템 바 아래까지 그려지므로, 게임 화면을 상태바·내비게이션 바·노치 안쪽에 둔다. 앱 이름은 "틀린그림 갤러리"다.

### iOS

- 필요: macOS, Xcode 16 이상. 스토어 배포는 Apple Developer Program 계정이 필요하다.
- 실행: `pnpm build:ios` → `pnpm --filter @spot-battle/ios open`(Xcode 열기) → 시뮬레이터나 기기 선택 후 실행
- 배포: Xcode에서 Signing & Capabilities에 팀을 지정한 뒤 Product → Archive → App Store Connect 업로드
- 번들 ID: `com.ninebarcode.spotdifference`, 최소 iOS 15. Capacitor 라이브러리는 GitHub의 `capacitor-swift-pm`에서 Swift Package Manager로 받는다(CocoaPods 불필요).
- 화면 노치·홈 바는 웹의 `env(safe-area-inset-*)`로 처리한다(`contentInset: never`, `viewport-fit=cover`).

## 아이콘·시작 화면

먹색 바탕의 금색 뷰파인더(게임의 찾은 표시와 같은 모양)를 쓴다.

- Android: `apps/android/app/src/main/res/mipmap-*/ic_launcher.png`
- iOS: `apps/ios/ios/App/App/Assets.xcassets/AppIcon.appiconset`(1024, 투명 없음), 시작 화면은 종이색 바탕의 작은 뷰파인더

## 자동 검증 (GitHub Actions)

| 워크플로 | 실행 시점 | 하는 일 |
|---|---|---|
| `Android APK Build` | 수동 실행, 또는 `apps/android`·빌드 스크립트를 바꾼 PR | 테스트, Gradle wrapper 검증, 디버그 APK 빌드·업로드, 서버 주소 확인 |
| `iOS App Build` | 수동 실행, 또는 `apps/ios`·빌드 스크립트를 바꾼 PR | 서명 없이 시뮬레이터용 앱 빌드·업로드, 서버 주소 확인 |

iOS 빌드는 macOS 실행기를 써서 GitHub Actions 사용 시간이 더 든다. 그래서 iOS 관련 파일이 바뀔 때만 자동으로 돈다.

## 출시 전 남은 일

- Android: release 서명 키, AAB 생성, 스토어(Google Play·ONE Store) 등록, 버전 정책(versionCode/versionName), 뒤로가기 동작, 화면 방향(현재 세로 고정)
- iOS: Apple 개발자 계정과 서명, App Store 심사 자료(스크린샷·개인정보 처리방침). 단순 웹 포장 앱은 심사(가이드라인 4.2)에서 거절될 수 있으므로 앱다운 기능(알림·오프라인 안내 등)을 검토한다.
- 공통: 실기기에서 닉네임 저장, 매칭, 그림 로딩, 정답·결과 흐름 확인. 토스 로그인 등 계정 연동은 `IMPLEMENTATION_BACKLOG.md`.
