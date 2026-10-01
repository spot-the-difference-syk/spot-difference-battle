# Spot the Difference Android 빌드 환경

## 목적

현재 정상 동작하는 React/Vite 게임과 Apps in Toss 빌드를 유지한 채 Android APK/AAB 출구를 추가한다.

Android 관련 변경은 게임 로직을 수정하지 않고 별도 wrapper로 시작한다. 첫 단계에서는 debug APK 생성까지를 목표로 하며, release 서명과 스토어 출시 설정은 후속 단계로 둔다.

참고 기준은 `9barcode/Oraksil_nonggu`의 Android 환경이다. 구조와 버전 조합만 참고하고, 게임 코드와 Android 호스트 구현은 Spot the Difference 저장소에 맞게 별도로 구성한다.

## 고정 버전

| 항목 | 고정값 | 용도 |
|---|---:|---|
| Node.js | 24 | 기존 React/Vite 웹 게임 빌드 |
| pnpm | 11.9.0 | 기존 monorepo 패키지 관리자 |
| JDK | 17 | Gradle 실행용 Java |
| Java source/target | 17 | Android Java 호환 수준 |
| Kotlin Gradle Plugin | 2.0.21 | Android Kotlin 컴파일러 플러그인 |
| Kotlin JVM target | 17 | Kotlin 바이트코드 타깃 |
| Gradle Wrapper | 8.13 | Android 빌드 실행 버전 |
| Android Gradle Plugin | 8.7.3 | Android 앱 빌드 플러그인 |
| compileSdk | 35 | 컴파일 시 참조 Android API |
| targetSdk | 35 | 앱이 대상으로 선언할 Android API |
| minSdk | 24 | 최소 설치 Android 버전(Android 7.0) |
| Android Build Tools | 35.0.0 | CI Android 빌드 도구 |
| AndroidX WebKit | 1.13.0 | WebViewAssetLoader 사용 |

NDK는 현재 고정하지 않는다. 이 Android wrapper는 네이티브 C/C++ 의존성이 없기 때문이다.

## 왜 이 조합을 쓰는가

오락실 농구 저장소에서 실제로 사용하는 조합을 참고한다.

- JDK 17
- Gradle 8.13
- Android Gradle Plugin 8.7.3
- Kotlin 2.0.21
- compileSdk/targetSdk 35
- minSdk 24
- Build Tools 35.0.0

Spot the Difference도 WebView wrapper 방식이므로 같은 계열의 Android 빌드 환경을 사용할 수 있다.

## 기존 게임과의 경계

다음 코드는 Android wrapper 때문에 수정하지 않는다.

- `apps/web/src/app/App.tsx`
- `apps/web/src/features/game/`
- `packages/game-core/`
- `packages/shared/`
- 게임 판정/점수/매칭/WebSocket 프로토콜
- Supabase 스키마
- R2 저장 구조
- Durable Objects 게임 상태 로직

Android는 `apps/web`의 Vite 산출물인 `dist/`를 앱 내부 assets로 복사하여 WebView에서 실행한다.

## Android 프로젝트 위치

```text
apps/
├─ web/                    기존 게임 본체
└─ android/                새 Android wrapper
   ├─ app/
   │  ├─ build.gradle.kts
   │  └─ src/main/
   │     ├─ AndroidManifest.xml
   │     └─ java/.../MainActivity.kt
   ├─ gradle/wrapper/
   ├─ build.gradle.kts
   ├─ settings.gradle.kts
   ├─ gradlew
   └─ gradlew.bat
```

## 빌드 흐름

```text
apps/web/src
    ↓
pnpm build:android:web
    ↓
apps/web/dist
    ↓
Android preBuild
    ↓
apps/android/app/src/main/assets
    ↓
Gradle
    ↓
APK / AAB
```

Apps in Toss 빌드는 기존 경로를 그대로 유지한다.

```text
apps/web/src
    ↓
pnpm build:ait
    ↓
spot-difference-syk.ait
```

## 서버 연결 원칙

현재 웹 게임은 production에서 별도 `VITE_SERVER_URL`이 없으면 현재 origin을 서버로 사용한다.

Android WebView는 앱 내부 HTTPS 가상 origin을 사용하므로 Android 빌드에서는 반드시 실제 Cloudflare Worker 주소를 `VITE_SERVER_URL`로 주입한다.

예:

```text
VITE_SERVER_URL=https://<production-worker-host>
```

실제 운영 주소는 임의로 하드코딩하지 않는다. 배포 환경에서 확인한 뒤 고정한다.

또한 Worker의 Origin 허용 정책에 Android WebView origin이 필요한지 실제 WebSocket 연결 테스트로 확인한다.

Android WebView의 로컬 자산 origin은 다음을 사용한다.

```text
https://appassets.androidplatform.net
```

## 보안 원칙

- `file://` 직접 로딩은 사용하지 않는다.
- `WebViewAssetLoader`를 사용해 앱 assets를 HTTPS 가상 origin으로 제공한다.
- JavaScript는 게임 실행을 위해 활성화한다.
- DOM storage는 guest token/nickname 저장을 위해 활성화한다.
- file/content access는 비활성화한다.
- HTTP mixed content는 허용하지 않는다.
- 외부 URL 이동은 기본 차단한다.
- Supabase 비밀번호, service role key, Cloudflare secret은 APK에 넣지 않는다.

## 검증 순서

1. 별도 branch에서 Android wrapper만 추가
2. 기존 `pnpm check`, `pnpm test` 통과 확인
3. 기존 `pnpm build:ait` 성공 확인
4. Android debug APK 빌드 성공 확인
5. 설치 후 닉네임 저장 확인
6. Cloudflare Worker WebSocket 연결 확인
7. 1:1 매칭 확인
8. 퍼즐 이미지 로딩 확인
9. 오답/정답/점수/종료 흐름 확인
10. AIT QR 실기 테스트를 다시 실행해 회귀가 없는지 확인

이 단계가 모두 성공하기 전에는 Android 변경을 main에 병합하지 않는다.

## 로컬 Windows 환경

필수:

- Node.js 24
- pnpm 11.9.0
- Temurin JDK 17
- Android SDK Platform 35
- Android Build Tools 35.0.0

확인:

```powershell
node -v
pnpm -v
java -version
$env:JAVA_HOME
```

Android 빌드는 Gradle Wrapper를 사용한다. 전역 Gradle 설치 버전을 기준으로 삼지 않는다.

예정 명령:

```powershell
pnpm install
pnpm build:android:web
cd apps/android
.\gradlew.bat :app:assembleDebug
```

## GitHub Actions 기준

Android workflow는 기존 AIT workflow와 동일하게 수동 실행(`workflow_dispatch`)만 허용한다.

CI 기준:

- ubuntu-latest
- Node.js 24
- pnpm 11.9.0
- Temurin JDK 17
- Android SDK Platform 35
- Build Tools 35.0.0
- Gradle Wrapper 8.13

산출물:

```text
apps/android/app/build/outputs/apk/debug/app-debug.apk
```

## 버전 의미

- JDK 17: Gradle과 Android 빌드 도구를 실행하는 Java
- Java 17: Java 소스 호환 수준
- Kotlin 2.0.21: Android Kotlin 코드 컴파일러 플러그인
- Kotlin JVM target 17: 생성되는 Kotlin 바이트코드 수준
- Gradle 8.13: 빌드 작업 실행기
- AGP 8.7.3: Gradle이 Android 앱을 빌드하도록 하는 플러그인
- compileSdk 35: Android API 35를 기준으로 컴파일
- targetSdk 35: Android 15 동작 정책을 대상으로 선언
- minSdk 24: Android 7.0 이상 설치 가능
- Node 24/pnpm 11.9.0: 기존 웹 게임 빌드 환경

Java 17과 Android API 35는 서로 다른 버전 체계다.

## 후속 결정

debug APK 및 실기기 검증 후 다음을 별도로 결정한다.

- 최종 Android applicationId
- 앱 표시 이름
- versionCode/versionName 정책
- release signing
- AAB 생성
- ONE Store/Google Play 배포 workflow
- Android 광고 SDK
- Android 뒤로가기 UX
- 화면 방향 고정 여부
