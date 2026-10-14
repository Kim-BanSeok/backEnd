# 협업 규칙

팀: 리더 1명 + 서브 1명. `main` 브랜치는 항상 "돌아가는 상태"로 유지하고, 모든 작업은 브랜치 → PR → 리더 리뷰 → 머지 순서로 합니다.

## 1. 한 번에 하나만 (기본 흐름)

```bash
# 0) 시작 전: main 을 최신으로
git switch main
git pull origin main
npm install                       # package.json 이 바뀌었을 수 있어요
npm run migrate && npm run migrate:test   # migrations/ 에 새 파일이 있었다면 필요

# 1) 내 작업 브랜치 만들기
git switch -c feature/patterns

# 2) 코드 작성 → 확인
npm run lint
npm test

# 3) 커밋 (작게, 자주)
git add src tests
git commit -m "feat(patterns): 도안 목록 조회 API"

# 4) 올리기 → GitHub 에서 PR 만들기
git push -u origin feature/patterns
```

### 작업 중 main 이 바뀌었을 때 (충돌 줄이기)
```bash
git fetch origin
git merge origin/main             # 충돌이 나면 아래 "충돌이 났을 때" 참고
npm run lint && npm test
```

### 충돌이 났을 때
1. 당황하지 말고 `git status` 로 충돌 난 파일을 확인합니다. (Both modified 로 표시)
2. 파일을 열면 `<<<<<<<`, `=======`, `>>>>>>>` 표시가 있습니다. 두 사람의 변경 **둘 다 필요한 경우가 대부분**입니다.
   - 특히 `src/routes/index.js` 는 서로 한 줄씩 추가한 것이니 **둘 다 남기면** 됩니다.
3. 표시를 지우고 `git add 파일` → `git commit`.
4. 어떻게 풀지 모르겠으면 **풀지 말고** 리더에게 물어보세요. (`git merge --abort` 로 되돌릴 수 있어요)

## 2. 브랜치와 커밋 이름

| 종류 | 브랜치 | 커밋 메시지 예 |
|---|---|---|
| 새 기능 | `feature/inquiries` | `feat(inquiries): 문의 작성 API` |
| 버그 수정 | `fix/login-error` | `fix(auth): 만료 토큰 오류 수정` |
| 문서 | `docs/readme` | `docs: README 시작 순서 수정` |
| 테스트 | `test/favorites` | `test(favorites): 중복 저장 테스트 추가` |

- 형식: `종류(범위): 한글로 무엇을 했는지`
- 브랜치는 **짧게**: API 1~3개 단위로 PR 을 올립니다. 오래 끌수록 충돌이 커져요.
- `main` 에 **직접 push 하지 않습니다.**

## 3. 담당과 순서

- 누가 어떤 API 를 맡는지는 [`docs/담당표.md`](docs/담당표.md) 에 있습니다. **담당이 아닌 기능은 건드리지 않습니다.** (같은 파일을 둘이 동시에 고치지 않는 가장 확실한 방법)
- 하고 싶은 다른 일이 생기면 먼저 말하고, 담당표를 같이 고칩니다.

## 4. 리더만 고치는 곳 (요청하세요)

| 파일·폴더 | 이유 | 필요하면 |
|---|---|---|
| `migrations/`, `src/models/` | 테이블이 바뀌면 모두의 DB 가 영향받음 | 어떤 컬럼이 왜 필요한지 적어서 요청 |
| `src/utils/errors.js`, `codes.js` | 오류 코드·코드값은 명세서와 연결됨 | 코드가 필요한 상황을 설명 |
| `src/middlewares/`, `src/config/`, `src/db/`, `src/app.js` | 모든 기능이 공통으로 사용 | 요청 |
| `package.json`, `package-lock.json` | 패키지 충돌과 보안 | 어떤 패키지가 왜 필요한지 요청 |
| `.env.example` | 새 환경변수는 모두에게 영향 | PR 에 적고 리더 확인 |

### DB(테이블)가 바뀌었다고 공지를 받으면
```bash
git pull origin main
npm run migrate
npm run migrate:test
```
오류가 나면 `README.md` 의 "문제가 생기면" 표를 보세요.

## 5. PR 올리기 전 체크리스트

API 하나를 "끝냈다"는 기준입니다. PR 템플릿에도 같은 목록이 있습니다.

- [ ] 명세서의 경로, 권한, 요청·응답 필드 이름, 오류 코드가 그대로다
- [ ] `validators` 에서 입력을 검사한다
- [ ] "안 된다"는 판단은 `services` 에만 있다 (controller, dao 에 규칙 없음)
- [ ] 남의 데이터를 건드리면 `FORBIDDEN` 이다
- [ ] `routes/index.js` 에 연결했다
- [ ] 테스트 4가지가 있다: **성공 / 권한 없음 / 입력 오류 / 상태 오류**
- [ ] `npm run lint` 통과
- [ ] `npm test` 통과
- [ ] 명세서와 다른 부분이 있다면 PR 에 이유를 적었다

PR 설명은 **3줄만** 적으면 됩니다: ① 무엇을 만들었나 ② 명세서와 다른 점 ③ 확인해 달라는 부분.

### 자동 검사 (CI)
`main`·`deploy/test` 대상 PR과 `main`·`deploy/test`·`deploy/chaeeun/review` 푸시에서 GitHub가 의존성 검사, `npm run lint`, `npm test`를 자동으로 실행합니다. PR 화면 아래쪽 **Checks**에서 ✅ 또는 ❌로 보입니다.

- 의존성 검사는 별도 `dependency-audit` 작업에서 `npm audit --package-lock-only --include=dev --audit-level=low --registry=https://registry.npmjs.org`를 실행합니다. 개발용 패키지까지 잠금 파일 기준으로 검사하며, `low` 이상 취약점이나 레지스트리 연결·검사 오류가 있으면 실패합니다. lint·테스트가 실패해도 의존성 검사는 독립적으로 실행됩니다.
- 검사 자체는 패키지를 설치하거나 자동 수정하지 않고 DB 설정·서비스를 사용하지 않습니다. `npm audit fix`를 CI에서 실행하지 않습니다. 발견된 취약점은 영향을 검토해 별도 변경으로 수정합니다.
- ❌ 이면 **머지하지 않습니다.** "Details" 를 눌러 어느 단계에서 어떤 오류가 났는지 확인하고, 고쳐서 같은 브랜치에 푸시하면 다시 실행됩니다.
- 내 컴퓨터에서는 통과하는데 CI 에서만 실패하면 `.env` 나 DB 에 남은 데이터에 의존하는 테스트일 수 있습니다. 리더에게 로그를 보여 주세요.
- GitHub 무료 플랜에서는 CI 가 실패해도 머지 버튼을 막을 수 없어서, 이 약속에 의존합니다.

## 6. 리더가 리뷰에서 보는 곳
1. **권한**: 로그인한 사람이 남의 원단·예약·문의를 건드릴 수 있는가
2. **규칙의 위치**: 판단이 services 에 있는가
3. **트랜잭션**: 여러 테이블을 바꾸는데 한 묶음인가
4. **응답 모양**: `{success, data}` 와 명세서 필드 이름 (식별자는 camelCase)
5. **쿼리**: 문자열을 이어 붙여 SQL 을 만들지 않았는가

리뷰 의견은 배우는 과정입니다. 고쳐서 같은 브랜치에 커밋을 더 올리면 PR 에 자동으로 반영됩니다.

## 7. AI(Claude 등)로 코딩할 때
- 프로젝트 루트의 `CLAUDE.md` 를 읽게 하세요. 폴더별 역할과 규칙이 들어 있어서 구조를 지켜 줍니다.
- AI 가 **`models/`, `migrations/`, `package.json` 을 고치려 하면** 멈추고 리더에게 물어보세요.
- AI 가 만든 코드도 `npm run lint` 와 `npm test` 가 통과해야 하고, 내가 **무슨 코드인지 이해한 뒤** PR 을 올립니다.
- AI 가 명세서와 다른 필드 이름이나 오류 코드를 만들어 내지 않았는지 확인하세요.
