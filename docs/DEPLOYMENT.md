# 컨테이너 배포

> 문서 상태: CURRENT
> 기준일: 2026-09-29

## 구성

Fastify, Socket.IO, React 정적 파일은 단일 Node.js 컨테이너에서 같은 도메인으로 제공할 수 있습니다. 브라우저는 별도 `VITE_SERVER_URL`이 없으면 현재 주소의 Socket.IO에 연결합니다. 영속 저장소는 Supabase PostgreSQL을 사용합니다.

- 웹·게임 서버: Docker 기반 단일 Node.js 서비스
- 상태 확인: `GET /health`
- 영속 저장소: Supabase PostgreSQL
- 활성 문제 이미지: 웹 정적 빌드에 포함된 WebP
- 컨테이너 정의: 루트의 `Dockerfile`

## 빌드 및 실행

저장소 루트에서 데이터베이스 마이그레이션을 적용한 뒤 컨테이너를 빌드하고 실행합니다.

```powershell
pnpm db:push
docker build -t spot-difference-battle .
docker run --rm -p 3001:3001 -e SUPABASE_DB_URL="<Supabase 연결 문자열>" spot-difference-battle
```

실제 서비스에서는 컨테이너 운영 환경의 비밀 환경 변수 설정 기능으로 `SUPABASE_DB_URL`을 전달합니다. 연결 문자열을 저장소나 이미지에 기록하지 않습니다.

브라우저에서 `http://localhost:3001`과 `http://localhost:3001/health`를 확인합니다. 앱 컨테이너는 DB 스키마를 변경하지 않으므로 새 버전 배포 전에 마이그레이션을 별도로 적용해야 합니다.

## 환경 변수

- `SUPABASE_DB_URL`: Supabase Dashboard에서 확인한 서버용 PostgreSQL 연결 문자열
- `PORT`: 웹 서버 포트. 기본값은 `3001`
- `HOST`: 바인딩 주소. 컨테이너에서는 `0.0.0.0` 사용
- `WEB_ORIGIN`: 웹 앱이 별도 도메인일 때 허용할 웹 주소
- `VITE_SERVER_URL`: 웹 앱과 서버가 다른 도메인일 때 웹 빌드 시 지정하는 서버 주소
- `WEB_ROOT`: 서버가 제공할 빌드된 웹 앱 경로

웹과 서버를 같은 도메인으로 제공하면 `WEB_ORIGIN`과 `VITE_SERVER_URL`을 비워 둡니다. 자세한 개발 기본값은 `.env.example`을 참고합니다.

## 배포 확인 및 되돌리기

- 배포된 서비스의 `/health`가 정상 응답하는지 확인합니다.
- PC와 모바일에서 매칭·준비·동시 시작·문제 이동·최종 점수 동기화를 확인합니다.
- 문제가 생기면 사용 중인 컨테이너 플랫폼에서 직전 정상 이미지 버전으로 되돌린 뒤 상태 확인과 2인 매칭을 다시 테스트합니다.
- 여러 서버 인스턴스로 확장하려면 Socket.IO 세션과 실시간 경기 상태를 공유하는 구성이 필요합니다.
