# 지도·공장 데이터 팀 인계

2026-10-13 확인 기준: 백엔드 main `1bb4ef2`의 README는 각 개발자 PC의 PostgreSQL 설치를 안내합니다. 공용 DB 주소는 저장소에 없습니다. 현재 지도 검증에 사용한 PostgreSQL 17.11은 이 작업 PC의 `127.0.0.1:54329`, DB `material_loop_local`입니다. 이것을 팀 공용 DB로 부르거나 외부에 개방하지 않습니다.

## 공유할 작업본

- 백엔드 `feature/factory-data-preparation`: 공장 원문 보존 마이그레이션, 고정 출처와 정제·적재·검증 명령, 부자재 후보 필터, 네이버 좌표 변환.
- 프론트 `feature/naver-factory-map`: 실제 공장 API와 네이버 지도 연결, 후보 목록·상세, 마커 선택·전체 위치 전환.
- 공장 원본과 전체 정제 결과는 [고정 출처](yangju-2026-09-source.json)에서 같은 명령으로 재현합니다. 로컬 DB 전체, 테스트 계정, 업로드, `.env`와 네이버 Secret은 Git에 포함하지 않습니다.
- 양쪽 작업은 main 대상 PR로 검토합니다. 백엔드 변경을 먼저 반영·적재한 뒤 프론트를 연결합니다.

## 기존 팀 환경에서 필요한 정보

| 항목 | 필요한 값 |
| --- | --- |
| DB 대상 | 서버 주소, 포트, 개발 DB 이름 |
| 접속 | 앱 계정·비밀번호, 직접 연결/SSH/VPN 등 접속 방식, TLS 요구사항과 필요한 CA |
| 팀 API | 이미 운영 중인 API의 주소와 코드 배포 담당자 |
| 지도 | 서버 Geocoding Client ID·Secret, 프론트 Web Dynamic Map Client ID와 등록된 도메인 |

비밀값은 비공개 환경 파일이나 팀의 비밀값 전달 경로로 전달합니다. 저장소의 `localhost`나 예시 계정을 실제 공용 주소로 간주하지 않습니다. SSH 터널의 localhost는 원격 DB일 수 있으므로 실제 서버 담당자와 대상도 확인합니다.

## 로컬 화면과 팀 공용 환경 연결

팀 API가 이미 있다면 로컬 프론트의 `API_PROXY_TARGET`을 그 API 주소로 설정하고 `VITE_API_BASE_URL=/api/v1`을 사용합니다. 개발 서버를 재시작합니다. 배포 프론트는 실제 API 주소를 `VITE_API_BASE_URL`에 지정하거나 배포 웹서버의 `/api` 프록시를 사용해 다시 빌드합니다.

백엔드 코드도 로컬에서 수정해야 한다면 [.env.team.example](../../.env.team.example)을 `.env.team`으로 복사하고 기존 팀 개발 DB 값을 입력합니다. 현재 연결 코드는 별도 TLS 설정을 지원하지 않으므로 TLS가 필수인 DB는 요구사항에 맞춰 연결 코드를 보완한 뒤 연결합니다. 로컬 `.env`를 보존하고 자동 테스트는 개인 전용 로컬 테스트 DB에서 실행합니다.

```powershell
# 백엔드 저장소에서 실행. 연결 대상과 테이블·적재 건수만 확인하며 DB를 변경하지 않는다.
node --env-file=.env.team scripts/inspect-database.js
```

로컬 API를 공용 DB에 연결한다고 사진 파일까지 공유되지는 않습니다. 현재 사진은 API 서버의 로컬 파일과 `PUBLIC_URL`을 사용하므로 다른 팀원과 사진까지 함께 보려면 팀 API·업로드 저장소를 함께 사용해야 합니다. 공장 지도 자체에는 업로드 파일이 필요하지 않습니다.

## 공장 데이터 반영

기존 팀 DB의 적용된 마이그레이션·중복 업체·백업 상태를 점검한 후 배포 담당자가 한 번 수행합니다. 상세 기준과 충돌 처리 규칙은 [적재 가이드](DEPLOYMENT.md)에 있습니다.

```powershell
node --env-file=.env.team node_modules/sequelize-cli/lib/sequelize db:migrate
node --env-file=.env.team scripts/import-prepared-yangju-factories.js --download
node --env-file=.env.team scripts/verify-factory-import.js
node --env-file=.env.team scripts/geocode-supply-factories.js
# 위 명령의 계획을 확인한 뒤 아직 없는 주소만 변환·저장한다.
node --env-file=.env.team scripts/geocode-supply-factories.js --apply
node --env-file=.env.team scripts/inspect-database.js
```

원본 2,925행 → 업체 그룹 2,919개, 부자재 후보 28곳·주소 26개가 기준입니다. 원문 보존 15건을 포함합니다. 로컬의 숫자 ID를 공용 DB에 강제 복사하지 않고 업체명·주소 기반 식별키로 기존 ID를 유지합니다. 좌표는 같은 주소로 검증되면 다시 조회하지 않습니다.

`npm test`, `migrate:test`, 테스트 초기화, 로컬 테스트 seed는 공용 DB에서 실행하지 않습니다. 원본 다운로드·좌표 조회와 코드 push만으로 실제 팀 DB가 바뀌지는 않습니다. 현재 공용 DB 접속·적재·서버 전환은 수행하지 않았습니다.

## 인계 전 검증

백엔드 전체 테스트 514개와 lint가 통과했습니다. 읽기 전용 점검으로 현재 로컬 DB에 업체 2,919개·후보 28곳·좌표 확인 28곳과 원문 보존 마이그레이션이 적용된 것을 확인했습니다. Git 커밋 대상에서 실제 DB 비밀번호·JWT 비밀값·네이버 Secret·AI 키가 포함되지 않은 것도 검사했습니다. 공용 DB 접속 정보는 미확인 상태입니다.
