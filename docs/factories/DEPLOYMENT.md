# 공장 자료 적재와 지도 연결

2026년 9월말 원본에서 2,919개 회사명·주소 그룹을 적재하며, 원본 2,925행의 회사명·주소·생산품을 보존합니다. 생산품 100자 초과 11건과 다른 생산품이 등록된 중복 4그룹을 포함합니다. 부자재 후보 28곳은 별도 상태로 기록하고 API에서 조회합니다.

## 로컬과 공용 DB에서 같은 자료 사용

현재 백엔드는 PostgreSQL입니다. 공용 환경에 DB 접속 정보를 제공하고 이 브랜치의 마이그레이션과 고정 출처 기록을 함께 배포합니다. DB 파일이나 로컬 계정 데이터를 복사하지 않습니다.

기존 팀 DB 확인과 환경 파일 분리·프론트 연결은 [팀 인계 안내](TEAM_HANDOFF.md)를 먼저 확인합니다. `node --env-file=.env.team scripts/inspect-database.js`로 접속 대상을 읽기 전용으로 확인할 수 있습니다.

`.env`를 사용하는 로컬·공용 서버에서 백엔드 저장소 루트 기준으로 실행합니다.

```powershell
npm run migrate
node --env-file=.env scripts/import-prepared-yangju-factories.js --download
node --env-file=.env scripts/verify-factory-import.js
node --env-file=.env scripts/geocode-supply-factories.js
```

배포 서버에서 환경변수를 주입하고 `.env` 파일을 사용하지 않는 경우에는 다음 명령을 사용합니다. `NODE_ENV=production`과 서버의 기존 필수 설정을 포함합니다.

```sh
node node_modules/sequelize-cli/lib/sequelize db:migrate --env production
node scripts/import-prepared-yangju-factories.js --download
node scripts/verify-factory-import.js
node scripts/geocode-supply-factories.js
```

`DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_ID`, `DB_PASS`는 해당 환경의 공용 DB를 가리킵니다. 네트워크·TLS 등 접속 조건은 실제 배포 DB 설정에 맞춰 구성해야 합니다. 테스트는 공용 DB에서 실행하지 않습니다.

출처의 기준월·파일 크기·SHA-256·시트명·엑셀 제목을 확인한 뒤 적재합니다. `--download`는 원본 파일이 없을 때 받으며, 변경된 원본이나 임의의 정제 JSON을 그대로 적재하지 않습니다. [출처 기록](yangju-2026-09-source.json)이 같은 원본을 고정합니다.

## DB 보존 방식

- `factories.industry`를 TEXT로 확장하여 생산품 전체 문구를 저장합니다.
- `source_key`에 회사명·주소의 고유키를 저장하고 UNIQUE 제약으로 중복을 막습니다. 기존 업체가 있으면 동일 회사명·주소의 ID를 유지합니다. 이미 중복된 레거시 DB는 임의로 삭제하지 않고 검토를 요구합니다.
- `source_record`에 생산품별 원문, 엑셀 행 번호, 중복·정제 사유와 부자재 선별 근거를 저장합니다.
- `factory_datasets`에 출처 기록과 전체 정제 레코드를 스냅샷으로 저장합니다. 다음 달 자료를 적재해도 이전 원문이 남습니다.
- 동일 파일·동일 정제 버전의 재적재는 업체 ID·등록 시각·좌표를 유지합니다. 직렬화 가능한 트랜잭션과 고유 제약으로 동시 적재도 중복을 만들지 않습니다.
- 새 자료에서 빠진 업체는 현재 조회에서 제외하고 이전 기록을 보존합니다. 더 오래된 월 자료로 현재 목록을 되돌리는 적재는 차단합니다.
- 기존 `factories:import`와 `factories:pull`도 동일한 원문 보존 적재기로 연결했습니다. 공용 배포의 기준 데이터 재현에는 자동으로 최신 월을 고르는 `factories:pull` 대신 위 고정 출처 명령을 사용합니다.

길이가 100자를 넘는 문구가 존재하면 이전 스키마로의 마이그레이션 롤백을 차단합니다. 원문을 자르며 되돌리지 않습니다.

## 부자재 후보 API

```text
GET /api/v1/factories?supply_status=candidate&page=0&size=50
```

현재 결과는 28곳입니다. `supply_status`는 candidate, review, excluded, unmatched 중 하나이며 생략하면 전체 현재 업체를 조회합니다. 기존 category 필터와 기존 응답 항목은 유지합니다. 원문 스냅샷과 내부 식별키는 공개 응답에 포함하지 않습니다.

프론트 `/buyer/supplies`와 공장 상세 주소는 저장된 시연 세션이 있어도 기본으로 실제 공개 API를 사용하며 로그인 없이 조회할 수 있습니다. 다음 페이지가 있으면 이어서 조회하고, 목록 선택·상세·복귀를 실제 업체 ID로 처리합니다. 좌표가 없는 업체도 주소와 생산품이 표시됩니다. 명시적인 `mode=demo` 또는 Figma 상태 예시는 기존 화면 비교용 데이터로 유지합니다.

## 네이버 지도 설정과 좌표 변환

서버 환경에 설정합니다. Secret은 프론트 환경변수로 전달하지 않습니다.

```dotenv
NAVER_MAPS_CLIENT_ID=서버_Application_Client_ID
NAVER_MAPS_CLIENT_SECRET=서버_Application_Client_Secret
```

프론트 빌드 환경에는 Web Dynamic Map의 Client ID를 설정합니다.

```dotenv
VITE_NAVER_MAPS_CLIENT_ID=지도_Application_Client_ID
```

[네이버 Maps Application](https://guide.ncloud-docs.com/docs/application-maps-app-vpc)에 Web Dynamic Map·Geocoding 사용 설정과 실제 로컬/배포 도메인을 등록합니다. SDK는 [공식 문서](https://navermaps.github.io/maps.js.ncp/docs/tutorial-2-Getting-Started.html)의 `ncpKeyId` 방식으로 로드합니다. 프론트 환경변수 변경 뒤 개발 서버 재시작 또는 배포 빌드가 필요합니다.

기본 좌표 명령은 호출 계획만 출력합니다. 실제 외부 호출과 좌표 저장은 `--apply`에서 수행합니다.

```powershell
node --env-file=.env scripts/geocode-supply-factories.js --apply
```

후보 28곳의 서로 다른 주소 26개를 검색합니다. 이미 같은 주소의 좌표가 확인된 그룹은 다시 호출하지 않습니다. 지번이 일치하는 결과만 채택하며, 부번 0의 생략(`44-0` → `44`)은 같은 지번으로 처리합니다. 원본 등록 주소는 유지합니다. 실패·불일치·서로 다른 좌표의 중복 결과는 위치를 확정하지 않습니다. 호출 제한과 일시 오류를 최대 3회 시도하고 인증 오류는 중단합니다. 결과는 DB와 Git 제외 `data/factories/map/` 폴더에 기록합니다.

같은 좌표의 업체는 지도 마커 하나로 묶고 목록에서는 각각 확인할 수 있습니다. 지도 키 누락·인증 실패·SDK 지연에서도 업체 목록을 사용할 수 있습니다. 좌표가 없는 항목을 임의의 위치에 배치하지 않습니다.

마커·목록 선택은 기존 지도에서 해당 좌표로 이동·확대하며, 선택 쿼리만 바뀔 때 지도를 다시 생성하지 않습니다. `전체 위치` 버튼으로 모든 공장을 다시 볼 수 있고 같은 마커를 다시 눌러도 확대됩니다.

네이버 GL 서브모듈을 사용해 마커 이동·확대와 `전체 위치` 복귀를 각각 300ms, `easeOutCubic` 전환으로 처리합니다. 벡터 지도 상세 배율 15는 이미지 지도 16과 같은 수준이며, 타일 페이드는 120ms입니다. GL 로드와 지도 초기화를 기다린 뒤 첫 범위·선택 위치를 적용합니다. 새 동작은 이전 이동을 중단합니다. WebGL 미지원 환경은 SDK의 이미지 지도 대체 동작을 사용하므로 부드러운 실수 배율 전환은 GL 환경에서 적용됩니다.

## 검증 결과 2026년 10월 13일

- 로컬 개발 DB 첫 적재: 추가 2,919건. 원본 2,925행, 긴 생산품 11건, 중복 생산품 4그룹 보존.
- 별도의 빈 PostgreSQL DB에서 초기·후속 마이그레이션과 같은 적재 명령을 실행해 동일 목록을 재현.
- 두 번째 적재: 추가 0, 수정 0, 그대로 2,919건. 스냅샷과 ID를 유지.
- 두 환경의 업체 식별키·이름·주소·생산품·출처·레코드 해시를 대조한 SHA-256: `18ba57b9ae921996080d53045ef3d2946ddb87fb931a9361712d7c51ca2699c1`.
- 기존 개발 DB의 공장 외 10개 업무 모델의 행 수와 전체 행 해시가 적재 전후 동일.
- 백엔드 전체 테스트 513개 통과, lint 통과. 신규 적재·좌표 테스트에는 동시 적재, 재적재, 월 갱신, 스냅샷 보존, 오류 좌표와 인증 실패를 포함.
- 프론트 지도·공장 전용 테스트 6개 통과, lint 신규 경고 0, 빌드 통과. 전체 384개 중 382개 통과. 기존 main에서도 재현되는 자투리 길이 검증 관련 테스트 2개 실패가 남음.
- 실제 HTTP·PostgreSQL로 데스크톱 1440px와 모바일 390px에서 28곳 조회, 선택·상세·복귀, 가로 넘침 없음과 키 미설정 안내 확인. 응답 대역 없이 검증했으며 실제 Naver SDK·Geocoding 호출은 키 미설정으로 실행하지 않음.
- 이후 키 설정과 서버 재시작을 완료하고 실제 Geocoding으로 26개 주소, 28곳의 좌표를 모두 저장함. 추가 실행의 남은 주소는 0개임.
- 실제 Naver SDK와 지도 타일로 데스크톱·모바일에서 26개 마커와 DB 좌표 28곳의 일치, 마커 아이콘 전체 표시, 목록·마커 상호 선택, 상세·복귀를 확인함. 브라우저 오류와 가로 넘침 없음. SDK 로딩 순서와 최초 지도 범위를 보완함.
- 키 설정 후 보완한 코드의 백엔드 전체 테스트 514개, 프론트 지도 전용 테스트 7개 및 빌드 통과. 양쪽 lint 오류 없음. 프론트 기존 판매자 음성 컴포넌트 경고 5개는 유지됨. [실제 지도 검증 기록](../../../frontend/docs/qa/factory-map-2026-10-13/naver-live/checks.json).
- 원본 DOCX의 기존 구역은 유지하고 API 48 공장 항목을 추가함. XML 텍스트·구조 대조는 수행했으며, 이 환경에 LibreOffice가 없어 Word 페이지 렌더 검증은 수행하지 못함.

공용 서버의 실제 배포·외부 DB 접속·네이버 인증 도메인 검증은 배포 접속 정보와 키를 설정한 환경에서 수행합니다. 로컬 빈 DB 재현 검증을 공용 서버 배포 완료로 표시하지 않습니다.
