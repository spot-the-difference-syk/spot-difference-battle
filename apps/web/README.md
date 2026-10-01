# Spot Difference Battle Web

> 문서 상태: CURRENT
> 이 폴더는 pnpm workspace의 `@spot-battle/web` 패키지다.

## 활성 앱

`src/main.tsx`가 `PuzzleCatalogProvider`로 감싼 `src/app/App.tsx`를 렌더한다. 화면은 `../../docs/SCREEN_SPEC.md`, 구현 기준은 `../../docs/design/UI_GUIDELINES.md`를 따른다. 같은 코드로 웹·앱인토스·Android(WebView)를 만든다.

## 실행

저장소 루트에서 웹과 개발 서버를 함께 띄운다.

```powershell
pnpm dev
```

기본 웹 주소는 `http://localhost:5173`이다. 개발 모드에서는 LAN에 바인딩하고, 다른 기기가 PC의 사설 IP로 접속하면 같은 PC의 `3001` 포트 개발 서버를 자동으로 쓴다. 서버 주소는 `VITE_SERVER_URL`로 바꿀 수 있다.

## 빌드

| 명령(저장소 루트) | 연결 대상 | 용도 |
|---|---|---|
| `pnpm build:cloudflare` | 같은 Worker의 `/ws` | 운영 웹 |
| `pnpm build:ait:cloudflare` | `VITE_SERVER_URL`의 Worker | 토스에 올리는 앱인토스 번들 |
| `pnpm build:ait` | 개발 서버(Socket.IO) | 로컬·CI 빌드 확인 |

## 검사

```powershell
pnpm --filter @spot-battle/web check
pnpm --filter @spot-battle/web test
```

이 폴더에서 별도의 `npm install`을 실행하지 않는다. 의존성은 저장소 루트의 pnpm workspace에서 관리한다.
