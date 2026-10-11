# Material Loop 백엔드 — AI 작업 규칙

이 프로젝트에서 코드를 쓰거나 고칠 때 반드시 지키는 규칙입니다. 사람 개발자도 같은 규칙을 씁니다.

## 기준 문서
- **API 명세서가 계약입니다:** `docs/Material_Loop_API_명세서_v0.3.docx` (읽기용 변환본 `docs/API_명세서_v0.3.md`).
  경로, 권한, 요청·응답 필드 이름, 오류 코드는 명세서와 **정확히 같아야** 합니다. 프론트엔드가 이 계약을 보고 일합니다.
- 명세서와 다르게 해야 할 것 같으면 **코드를 바꾸지 말고** 먼저 리더에게 물어보세요.
- 서버를 켜고 `/api-docs` 를 열면 명세서의 API 를 Swagger 로 볼 수 있습니다. `src/docs/openapi.json` 은 명세서에서 **자동 생성**되는 파일이라 직접 고치지 않습니다. 명세서에 없는 경로를 만들면 `tests/docs.test.js` 가 실패합니다.
- DB 구조는 `src/models/` 와 `migrations/`, 설명은 `ERD_테이블정리_수정본.md` 입니다.
- 담당 기능은 `docs/담당표.md` 에서 확인합니다. 내 담당이 아닌 기능은 건드리지 않습니다.

## 요청이 지나가는 길과 각 폴더의 역할

`routes → controllers → services → dao → DB`

| 폴더 | 하는 일 | 하지 않는 일 |
|---|---|---|
| `routes/` | 주소, 메서드, 권한(`requireAuth('SELLER')`), 입력 검사(`validate(...)`) 연결 | 업무 규칙, DB |
| `controllers/` | `req.valid`, `req.user` 를 꺼내 service 를 부르고 `ok(res, data, status)` 로 응답 | 업무 규칙, DB |
| `services/` | **"안 된다"는 판단**(`throw fail('코드')`), 본인 것인지 확인, 응답 모양 만들기, 트랜잭션 | `req`/`res` 사용, 쿼리 직접 작성 |
| `dao/` | 모델 호출로 DB 읽기·쓰기. 없으면 `null` 을 돌려줌 | 규칙 판단, 오류 던지기, `req`/`res` |
| `validators/` | zod 로 값의 **형식** 검사 | DB 를 봐야 아는 검사 (service 가 함) |
| `middlewares/` | 로그인 확인, 입력 검사 실행, 오류 응답 등 공통 처리 | 특정 기능의 규칙 |

새 API 는 **`validators → dao → services → controllers → routes`** 순서로 만들고, `src/routes/index.js` 에 한 줄을 추가합니다.

## 따라 할 기준 예시 (회원 API)
새 기능을 만들 때 이 파일들과 같은 모양으로 씁니다.
- `src/routes/auth.routes.js`, `src/routes/users.routes.js`
- `src/validators/auth.schema.js`, `src/validators/users.schema.js`
- `src/controllers/auth.controller.js`, `src/controllers/users.controller.js`
- `src/services/auth.service.js`, `src/services/users.service.js` (오류 던지기, 응답 변환 `toMeResponse`)
- `src/dao/users.dao.js`, `src/dao/stores.dao.js`
- 매장 API 도 좋은 예시입니다: `src/routes/stores.routes.js`(공개 API, 경로 순서), `src/services/stores.service.js`, `src/validators/stores.schema.js`(path 값 검사)
- `tests/auth.test.js`, `tests/stores.test.js` (테스트 작성 방법)

## 꼭 지킬 규칙

1. **응답은 `ok(res, data, status)`** 로 보냅니다 → `{ "success": true, "data": ... }`. 돌려줄 내용이 없는 성공은 `200` 과 `data: null`.
2. **오류는 `throw fail('오류코드')`** 로 던집니다(`src/utils/errors.js`). 코드와 한글 메시지는 명세서 3장과 같고, 응답 형식은 `errorHandler` 가 만듭니다.
   표에 없는 새 오류 코드는 **만들지 말고** 리더에게 요청하세요.
3. **식별자는 camelCase, 나머지는 snake_case** 로 응답합니다. 모델은 `user_id` 이지만 응답은 `userId` 입니다.
   모델을 그대로 응답하지 말고, service 에서 응답 모양으로 변환합니다(`users.service.js` 의 `toMeResponse` 참고).
   `password_hash`, `deleted_at` 같은 내부 값은 응답에 넣지 않습니다.
4. **날짜는 `toKstIso(date)`** (`utils/response.js`) 로 한국 시간 문자열로 바꿔 응답합니다. 예: `2026-10-14T15:00:00+09:00`
5. **목록은 `page`(0부터, 기본 0), `size`(기본 20, 최대 50)** 를 받고 `{ content, page, size, totalElements, totalPages }` 로 응답합니다. 범위를 벗어나면 `VALIDATION_ERROR`.
6. **"안 된다"는 판단은 service 에만** 씁니다. controller 나 dao 에 규칙을 넣지 않습니다.
7. **공개 API 에는 `optionalAuth`** 를 붙입니다. 로그인 없이도 되지만, 잘못된 토큰을 보내면 401 입니다(명세서 2.3). 로그인하면 더 보이는 API 는 `req.user` 로 판단합니다.
   **고정 경로(`/stores/me`)는 변수 경로(`/stores/:storeId`)보다 먼저** 선언합니다. 아니면 `me` 가 id 로 읽힙니다.
7-1. **내 것이 아닌 데이터(남의 원단·예약·문의)는 `FORBIDDEN`** 입니다. 로그인한 사용자는 `req.user.userId`, `req.user.role` 로 알 수 있습니다.
8. **코드값(enum)** 은 `src/utils/codes.js` 의 목록을 씁니다. 문자열을 직접 쓰지 않습니다.
9. **환경변수는 `src/config/env.js` 에서만** 읽습니다. `process.env` 를 직접 쓰지 않습니다.
10. 쿼리는 Sequelize 모델 메서드로만 씁니다. 문자열을 이어 붙여 SQL 을 만들지 않습니다.
11. 삭제는 `deleted_at`(soft delete)입니다. `users`, `fabrics`, `inquiries` 는 `destroy()` 가 자동으로 `deleted_at` 을 채우고, 조회에서 자동으로 빠집니다.
12. 여러 테이블을 한 번에 바꾸는 작업은 **트랜잭션** 으로 묶습니다 (dao 함수는 `options = {}` 로 `{ transaction }` 을 받습니다).
13. **같은 원단의 재고·상태를 바꾸는 작업(예약 요청·수락·취소·수령, 원단 수정·삭제, 게시 승인)은 모두 원단 행을 먼저 잠급니다** (`fabricsDao.lockById(id, { transaction })`).
    그래야 동시에 눌러도 재고가 어긋나지 않습니다. 새 기능이 원단의 `status`, `remaining_length_cm`, `reserved_length_cm` 을 바꾼다면 반드시 같은 순서(잠금 → 다시 읽기 → 규칙 확인 → 변경)를 따르세요.

## 건드리지 말 것 (리더만 수정)
- `src/models/`, `migrations/` — 컬럼이 필요하면 **직접 고치지 말고** 리더에게 요청합니다. 이미 있는 마이그레이션 파일은 절대 수정하지 않습니다.
- `src/middlewares/`, `src/utils/`, `src/config/`, `src/db/`, `src/app.js`, `eslint.config.js`
- `package.json` 의 의존성 (패키지가 필요하면 먼저 물어보기)
- `.env` (내 컴퓨터 전용, Git 에 올리지 않음)

## 테스트와 검사
- 새 API 마다 `tests/` 에 테스트를 씁니다. **4가지**: ① 성공 ② 권한 없음(401·403) ③ 입력 오류(400) ④ 상태 오류(409 등).
- 테스트 도우미: `tests/helpers.js` (`resetDb`, `makeUser`, `makeStore`, `makeFabric`). 테스트는 `_test` DB 에서만 돕니다.
- 끝내기 전에 `npm run lint` 와 `npm test` 가 **둘 다 통과**해야 합니다. 통과하지 못했다면 통과했다고 말하지 않습니다.

## 명령어
`npm run dev`, `npm test`, `npm run lint`, `npm run migrate`, `npm run migrate:test` — 자세한 설명은 `README.md`.

## 작업 방식
- 브랜치 이름, 커밋 메시지, PR 규칙은 `CONTRIBUTING.md` 를 따릅니다.
- 한 번에 API 1~3개 단위로 작게 작업합니다.
- 확실하지 않은 것은 추측해서 만들지 말고, 무엇이 불확실한지 적어서 질문합니다.
