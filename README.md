# Material Loop 백엔드

양주시 자투리 원단 거래 웹 서비스의 백엔드입니다. Node.js + Express + PostgreSQL(Sequelize)로 만들고 있습니다.

API는 47개(필수 38, 선택 9)이고, 기준은 **`docs/Material_Loop_API_명세서_v0.3.docx`** 입니다.
(같은 내용을 읽기 쉽게 변환한 `docs/API_명세서_v0.3.md`도 있지만, 원본은 docx 입니다.)

처음 참여한다면 이 문서를 위에서부터 따라 하고, 그다음 [docs/서브_시작_가이드.md](docs/서브_시작_가이드.md) 와 [CONTRIBUTING.md](CONTRIBUTING.md) 를 읽으세요.

## 1. 처음 시작하기

### 설치할 것
- **Node.js 24** (<https://nodejs.org>) — 설치 후 터미널에서 `node --version` 으로 확인
- **PostgreSQL** (<https://www.postgresql.org/download/>) — 설치할 때 정한 비밀번호를 기억해 두세요
- **Git**

### 실행 순서

```bash
# 1) 패키지 설치
npm install

# 2) 설정 파일 만들기 (복사 후 DB_PASS 등을 내 값으로 고치기)
cp .env.example .env              # PowerShell: Copy-Item .env.example .env

# 3) DB 만들기 (개발용 + 테스트용 2개가 만들어져요)
npm run db:ensure
npm run db:ensure:test

# 4) 테이블 만들기
npm run migrate
npm run migrate:test

# 4-1) 운영팀(ADMIN) 계정 만들기 (.env 의 ADMIN_EMAIL, ADMIN_PASSWORD 사용. 이미 있으면 다시 만들지 않아요)
npm run db:seed

# 5) 테스트가 통과하는지 확인
npm test

# 6) 서버 켜기
npm run dev
```

서버가 켜지면 <http://localhost:3000/api/v1/health> 에서 `{"success":true,"data":{"status":"ok"}}` 가 보여야 합니다.

### `.env` 에서 고칠 것

| 변수 | 설명 |
|---|---|
| `DB_ID` | PostgreSQL 사용자 이름 (보통 `postgres`) |
| `DB_PASS` | PostgreSQL 설치 때 정한 비밀번호 |
| `DB_DATABASE` | 개발용 DB 이름. 테스트용 DB 는 뒤에 `_test` 를 붙인 이름을 **자동으로** 씁니다 |
| `JWT_SECRET` | 로그인 토큰 비밀값. 개발 중에는 아무 긴 문자열이면 됩니다 |
| `AI_PROVIDER`, `OPENAI_API_KEY` | AI 보조 등록. 기본 `fake`(키 없이 쓰는 개발용 규칙)이고, 운영에서는 `openai` 와 키가 필요합니다. 세션은 서버 메모리에 저장되어 서버를 다시 켜면 사라집니다 |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | 운영팀(ADMIN) 계정. 가입 API 로는 만들 수 없어서 `npm run db:seed` 가 이 값으로 **처음 한 번** 만듭니다 (비밀번호 8~72자) |

사진은 지금 내 컴퓨터의 `uploads/` 폴더에 저장되고 `PUBLIC_URL`(기본 `http://localhost:3000`) 주소로 보입니다. 이 폴더도 Git 에 올리지 않습니다. 나중에 클라우드 저장소로 옮길 때는 `src/storage/` 에 제공자만 추가합니다.

`.env` 는 내 컴퓨터에만 있는 파일입니다. **Git 에 올리지 않습니다.** (이미 `.gitignore` 에 들어 있어요)

### 개발 DB 와 테스트 DB 가 따로 있는 이유
`npm test` 는 시작할 때 모든 테이블을 **전부 비웁니다.** 개발 DB 하나만 쓰면 내가 넣어 둔 데이터가 테스트 때마다 사라집니다.
그래서 테스트는 이름이 `_test` 로 끝나는 DB 에서만 실행됩니다. 둘 다 내 컴퓨터의 PostgreSQL 안에 있습니다.

## 2. 명령어

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 서버 켜기 (코드를 고치면 자동으로 다시 시작) |
| `npm test` | 자동 테스트 (테스트 DB 사용) |
| `npm run lint` | 코드 검사 (eslint) |
| `npm run db:ensure` / `db:ensure:test` | 개발 DB / 테스트 DB 가 없으면 만들기 |
| `npm run migrate` / `migrate:test` | 개발 DB / 테스트 DB 에 테이블 변경 적용 |
| `npm run migrate:status` | 적용된 변경 목록 보기 |
| `npm run db:seed` | 운영팀(ADMIN) 계정 만들기. 이미 있으면 그대로 두니 여러 번 실행해도 안전해요 |
| `npm run docs:build` | 명세서에서 API 문서(Swagger)를 다시 만들기 |

**누군가 `migrations/` 에 새 파일을 올렸다면**, `git pull` 후 `npm run migrate` 와 `npm run migrate:test` 를 둘 다 실행하세요.

## 3. 폴더 구조

```
src/
├─ app.js, server.js     앱 조립 / 서버 켜기
├─ config/env.js         환경변수를 읽는 유일한 곳
├─ routes/               주소와 권한을 연결 (routes/index.js 에 한 줄씩 추가)
├─ controllers/          요청을 꺼내 service 를 부르고 응답
├─ services/             업무 규칙, 권한 확인, 오류 코드 결정  ← 가장 자주 고침
├─ dao/                  DB 읽기·쓰기 (Sequelize 모델 호출)
├─ validators/           요청 값의 형식 검사 (zod)
├─ middlewares/          로그인 확인, 입력 검사, 오류 응답 등 공통 처리
├─ models/               테이블 정의 (리더만 수정)
├─ db/                   DB 연결(connection.js), 처음 필요한 데이터(seedAdmin.js)
├─ storage/              사진 저장소 (지금은 내 컴퓨터의 uploads/, 나중에 클라우드로 교체)
├─ docs/                 Swagger API 문서 (명세서에서 자동 생성, 직접 고치지 않기)
├─ ai/                   AI 보조 등록: 질문 흐름(flow), 가짜 AI(개발용), OpenAI, 프롬프트
└─ utils/                오류 코드(errors.js), 응답(response.js), 코드값(codes.js)
migrations/              테이블 변경 기록 (리더만 추가)
scripts/                 npm run 으로 실행하는 한 번짜리 작업 (DB 만들기, 시드, 문서 생성)
tests/                   자동 테스트
docs/                    API 명세서, 담당표, 서브 시작 가이드
```

요청은 `routes → controllers → services → dao → DB` 순서로 지나갑니다. 각 폴더의 역할은 [CLAUDE.md](CLAUDE.md) 에 자세히 있습니다.

## 3-1. API 문서 (Swagger)

서버를 켜고 <http://localhost:3000/api-docs> 를 열면 **명세서의 API 47개**가 목록으로 보이고, 요청 항목·응답 예시·오류 코드를 확인하거나 바로 호출해 볼 수 있습니다. 아직 구현되지 않은 API 도 보입니다. (프론트엔드가 서버 완성 전에 연동을 시작하는 용도)

- 로그인이 필요한 API 는 `POST /auth/login` 으로 받은 `accessToken` 을 오른쪽 위 **Authorize** 에 붙여 넣으세요.
- 문서는 `docs/API_명세서_v0.3.md` 에서 **자동으로 만들어집니다.** 직접 고치지 마세요 (`src/docs/openapi.json` 은 생성 파일).
- 운영(`NODE_ENV=production`)에서는 기본으로 꺼집니다. 켜려면 `DOCS_ENABLED=true`.

**명세서가 바뀌었다면 (리더)**
```bash
python scripts/docx-to-md.py docs/Material_Loop_API_명세서_v0.3.docx docs/API_명세서_v0.3.md   # docx → 읽기용 md
npm run docs:build                                                                          # md → Swagger 문서
npm test                                                                                    # 문서와 명세서가 같은지 확인
```
명세서만 고치고 `docs:build` 를 빼먹으면 `npm test`(CI 포함)가 실패합니다. 코드에 **명세서에 없는 API** 를 만들어도 실패합니다.

## 4. 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| `password authentication failed` | `.env` 의 `DB_PASS` 가 PostgreSQL 비밀번호와 같은지 |
| `database "..." does not exist` | `npm run db:ensure` 와 `npm run db:ensure:test` 를 실행했는지 |
| `relation "users" does not exist` | `npm run migrate` 와 `npm run migrate:test` 를 실행했는지 |
| `ECONNREFUSED 5432` | PostgreSQL 이 켜져 있는지 (Windows: 서비스에서 `postgresql` 확인) |
| 테스트가 `_test` 관련 오류로 멈춤 | 정상입니다. 테스트가 개발 DB 를 지우지 않도록 막은 것입니다. `.env` 의 DB 이름을 확인하세요 |
