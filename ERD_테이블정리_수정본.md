> 이 파일은 Google 문서 `ERD_테이블정리_수정본.md`를 2026-10-10에 내보낸 사본입니다. 원본은 Google 문서이고, 내용이 바뀌면 다시 내보내야 합니다.

# ERD 테이블 정리

양주시 자투리 원단 거래 웹 서비스 · DB 설계 기준: PostgreSQL(관계형) + MongoDB(AI 등록 세션)

---

## 1. 영문 이름 규칙 (추천)

| 대상 | 규칙 | 예 |
| :---- | :---- | :---- |
| 테이블명 | 소문자 snake_case, 복수형 | users, fabrics, pattern_parts |
| PK | 단수형 + `_id` | user_id, fabric_id (예외: fabric_images → image_id, pattern_parts → part_id) |
| FK | 참조하는 테이블의 PK 이름 그대로 | fabrics.store_id → stores.store_id |
| 회원 FK의 역할 구분 | 역할 이름 + `_id` | buyer_id, seller_id (둘 다 users 참조) |
| 날짜 | `created_at` / `updated_at` / `deleted_at` / `~_at`, 타입은 TIMESTAMPTZ(시간대 포함, API는 한국 시간 +09:00로 변환) | picked_up_at, answered_at |
| 참·거짓 | `is_` / `has_`로 시작 | is_private, has_defect |
| 길이 | 단위를 이름에 붙임 | width_cm, length_cm |
| 상태·코드 값 | 영문 대문자 | PENDING, SCRAP, COTTON |

---

## 2. 테이블 정의

### 2.1 users (회원)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| user_id | 회원 ID | BIGINT | Y |  | N | AUTO | 회원 식별자 |
| email | 이메일 | VARCHAR(255) |  |  | N |  | 로그인 이메일, 탈퇴하지 않은 회원 사이에서 중복 불가(탈퇴한 이메일은 재가입 가능) |
| password_hash | 비밀번호 | VARCHAR(255) |  |  | N |  | 비밀번호 전용 단방향 해시 |
| nickname | 닉네임 | VARCHAR(50) |  |  | N |  | 예약·문의 목록 표시용 |
| phone_number | 전화번호 | VARCHAR(20) |  |  | Y | NULL | 선택 입력 |
| role | 역할 | VARCHAR(10) |  |  | N |  | SELLER / BUYER / ADMIN |
| seller_approval_status | 판매자 승인 상태 | VARCHAR(20) |  |  | Y | NULL | PENDING / APPROVED / REJECTED, 판매자 가입 시 PENDING |
| privacy_agreed | 개인정보 동의여부 | BOOLEAN |  |  | N | FALSE | 가입 시 TRUE 필수 |
| terms_agreed | 이용약관 동의여부 | BOOLEAN |  |  | N | FALSE | 가입 시 TRUE 필수 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |
| deleted_at | 탈퇴일 | TIMESTAMPTZ |  |  | Y | NULL | 값이 있으면 탈퇴 회원 |

### 2.2 stores (매장)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| store_id | 매장 ID | BIGINT | Y |  | N | AUTO |  |
| user_id | 회원 ID | BIGINT |  | Y | N |  | 판매자(users), 판매자당 1개 |
| store_name | 매장명 | VARCHAR(100) |  |  | N |  |  |
| store_address | 매장 주소 | VARCHAR(255) |  |  | N |  | 픽업 장소 |
| store_phone | 매장 전화번호 | VARCHAR(20) |  |  | N |  |  |
| closed_days | 휴무일 | VARCHAR(100) |  |  | Y | NULL | 예: 매주 일요일 |
| pickup_guide | 픽업 안내 | TEXT |  |  | Y | NULL | 픽업 가능 시간, 위치, 현장 결제 안내 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.3 fabrics (원단정보)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| fabric_id | 원단 ID | BIGINT | Y |  | N | AUTO |  |
| store_id | 매장 ID | BIGINT |  | Y | N |  | stores |
| title | 원단글 제목 | VARCHAR(100) |  |  | N |  | 원단 이름 |
| sale_type | 판매 형태 | VARCHAR(10) |  |  | N |  | SCRAP(자투리) / ROLL(롤) |
| price | 가격 | INT |  |  | N |  | 자투리: 장당 / 롤: 90cm당(원) |
| remaining_length_cm | 남은 길이 | INT |  |  | Y | NULL | 롤만(cm), 자투리는 NULL |
| reserved_length_cm | 확보 길이 | INT |  |  | N | 0 | 롤: 수락된 예약 길이 합계 |
| status | 상태 | VARCHAR(20) |  |  | N | PENDING | PENDING(게시대기) / POSTED(게시중) / REJECTED(반려) / SOLD_OUT(판매완료) |
| reject_reason | 반려 사유 | VARCHAR(255) |  |  | Y | NULL | REJECTED일 때 필수. 판매자가 수정하면 PENDING으로 돌아감 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |
| deleted_at | 삭제일 | TIMESTAMPTZ |  |  | Y | NULL | 값이 있으면 삭제된 원단 |

### 2.4 fabric_details (원단 상세)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| fabric_detail_id | 원단상세 ID | BIGINT | Y |  | N | AUTO |  |
| fabric_id | 원단 ID | BIGINT |  | Y | N |  | fabrics, 원단당 1개 |
| width_cm | 가로(폭) | INT |  |  | N |  | 자투리: 사용 가능 가로 / 롤: 폭 |
| length_cm | 세로(길이) | INT |  |  | Y | NULL | 자투리만, 30~90 / 롤은 NULL |
| material | 소재 | VARCHAR(20) |  |  | N | UNKNOWN | COTTON / LINEN / POLYESTER / NYLON / RAYON / WOOL / BLEND / ETC / UNKNOWN |
| thickness | 두께 | VARCHAR(10) |  |  | N |  | THIN / NORMAL / THICK |
| color_family | 색상 | VARCHAR(10) |  |  | N |  | WHITE / BLACK / GRAY / BEIGE / BROWN / RED / PINK / YELLOW / GREEN / BLUE / NAVY / PURPLE / MIXED |
| color_detail | 색상 상세 | VARCHAR(100) |  |  | Y | NULL | 무늬·정확한 색 이름 |
| has_defect | 하자 유무 | BOOLEAN |  |  | N | FALSE |  |
| defect_note | 하자 내용 | VARCHAR(255) |  |  | Y | NULL | 위치·내용, 롤은 시작점 기준 cm |
| blend_ratio | 혼용률 | VARCHAR(100) |  |  | Y | NULL | 확인된 경우만 |
| weave | 짜임 | VARCHAR(50) |  |  | Y | NULL |  |
| grain_direction | 결 방향 | VARCHAR(50) |  |  | Y | NULL |  |
| description | 판매자 설명 | TEXT |  |  | Y | NULL |  |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.5 fabric_images (이미지 정보)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| image_id | 이미지 ID | BIGINT | Y |  | N | AUTO |  |
| fabric_id | 원단 ID | BIGINT |  | Y | N |  | fabrics, 원단당 1~3장 |
| image_url | 이미지 주소 | VARCHAR(500) |  |  | N |  | 객체 저장소 URL |
| thumbnail_url | 썸네일 주소 | VARCHAR(500) |  |  | Y | NULL | 목록용 작은 이미지 |
| image_type | 이미지 종류 | VARCHAR(10) |  |  | Y | NULL | FULL(전체) / ZOOM(확대) / DEFECT(하자) |
| sort_order | 표시 순서 | SMALLINT |  |  | N | 0 | 0이 대표 이미지. 최대 3장은 앱에서 검사 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.6 reservations (픽업 예약)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| reservation_id | 예약 ID | BIGINT | Y |  | N | AUTO |  |
| fabric_id | 원단 ID | BIGINT |  | Y | N |  | fabrics |
| buyer_id | 구매 회원 ID | BIGINT |  | Y | N |  | users |
| seller_id | 판매 회원 ID | BIGINT |  | Y | N |  | users, 조회 편의용 |
| pattern_id | 도안 ID | BIGINT |  | Y | Y | NULL | patterns, 도안을 고르고 예약한 경우 |
| requested_length_cm | 요청 길이 | INT |  |  | Y | NULL | 롤만, 90cm 단위 / 자투리는 NULL |
| estimated_price | 예상 금액 | INT |  |  | Y | NULL | 롤: 90cm당 가격 × 마 수 |
| pickup_at | 픽업 일시 | TIMESTAMPTZ |  |  | N |  | 구매자 희망 → 수락 시 확정 |
| memo | 요청 메모 | VARCHAR(500) |  |  | Y | NULL |  |
| status | 상태 | VARCHAR(20) |  |  | N | REQUESTED | REQUESTED / ACCEPTED / REJECTED / CANCELED / PICKED_UP |
| reject_reason | 거절 사유 | VARCHAR(255) |  |  | Y | NULL | REJECTED일 때 필수 |
| canceled_by | 취소 주체 | VARCHAR(10) |  |  | Y | NULL | BUYER / SELLER |
| accepted_at | 수락일 | TIMESTAMPTZ |  |  | Y | NULL |  |
| picked_up_at | 수령일 | TIMESTAMPTZ |  |  | Y | NULL |  |
| canceled_at | 취소일 | TIMESTAMPTZ |  |  | Y | NULL |  |
| created_at | 요청일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.7 patterns (도안)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| pattern_id | 도안 ID | BIGINT | Y |  | N | AUTO |  |
| pattern_name | 도안명 | VARCHAR(100) |  |  | N |  | 예: 에코백 |
| aliases | 별칭 | VARCHAR(255) |  |  | Y | NULL | 예: 장바구니, 토트백 |
| category | 종류 | VARCHAR(50) |  |  | Y | NULL | 예: 가방, 소품, 생활용품 |
| description | 설명 | TEXT |  |  | Y | NULL | 제작 단계 요약 |
| image_url | 이미지 주소 | VARCHAR(500) |  |  | Y | NULL | 완성품 이미지 |
| allowed_materials | 허용 소재 | TEXT[] |  |  | N |  | fabric_details.material 코드 중 선택 |
| allowed_thickness | 허용 두께 | TEXT[] |  |  | N |  | THIN / NORMAL / THICK 중 선택 |
| reviewed_by | 검토자 | VARCHAR(50) |  |  | Y | NULL | 검토한 제작 경험자 |
| is_active | 사용 여부 | BOOLEAN |  |  | N | TRUE | FALSE면 추천에서 제외 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.8 pattern_parts (도안 부품)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| part_id | 부품 ID | BIGINT | Y |  | N | AUTO |  |
| pattern_id | 도안 ID | BIGINT |  | Y | N |  | patterns, 도안 삭제 시 함께 삭제 |
| part_name | 부품명 | VARCHAR(50) |  |  | N |  | 예: 앞판, 끈 |
| width_cm | 가로 | INT |  |  | N |  | 시접 포함(cm), 원단 가로(폭) 방향 |
| height_cm | 세로 | INT |  |  | N |  | 시접 포함(cm), 원단 세로(식서) 방향 |
| quantity | 장수 | INT |  |  | N | 1 | 1 이상 |

### 2.9 favorites (관심 저장)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| favorite_id | 관심 ID | BIGINT | Y |  | N | AUTO |  |
| user_id | 회원 ID | BIGINT |  | Y | N |  | users |
| target_type | 종류 | VARCHAR(10) |  |  | N |  | FABRIC(원단) / PATTERN(도안) |
| fabric_id | 원단 ID | BIGINT |  | Y | Y | NULL | target_type이 FABRIC일 때만 |
| pattern_id | 도안 ID | BIGINT |  | Y | Y | NULL | target_type이 PATTERN일 때만 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.10 inquiries (문의)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| inquiry_id | 문의 ID | BIGINT | Y |  | N | AUTO |  |
| fabric_id | 원단 ID | BIGINT |  | Y | N |  | 문의 대상 원단(fabrics) |
| buyer_id | 문의 회원 ID | BIGINT |  | Y | N |  | 구매자(users) |
| seller_id | 판매 회원 ID | BIGINT |  | Y | N |  | 판매자(users), 조회 편의용 |
| content | 문의 내용 | VARCHAR(1000) |  |  | N |  |  |
| is_private | 비공개 여부 | BOOLEAN |  |  | N | FALSE | TRUE면 문의자와 판매자만 열람 |
| status | 상태 | VARCHAR(20) |  |  | N | WAITING | WAITING(답변 대기) / ANSWERED(답변 완료) |
| answer | 답변 내용 | VARCHAR(1000) |  |  | Y | NULL | 판매자 답변 |
| answered_at | 답변일 | TIMESTAMPTZ |  |  | Y | NULL |  |
| created_at | 문의일 | TIMESTAMPTZ |  |  | N | NOW |  |
| updated_at | 수정일 | TIMESTAMPTZ |  |  | N | NOW |  |
| deleted_at | 삭제일 | TIMESTAMPTZ |  |  | Y | NULL | 값이 있으면 삭제된 문의 |

### 2.11 factories (공장 리스트, 공공데이터, 임시)

| 컬럼명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| factory_id | 공장 ID | BIGINT | Y |  | N | AUTO |  |
| factory_name | 업체명 | VARCHAR(100) |  |  | N |  |  |
| industry | 업종 | VARCHAR(100) |  |  | Y | NULL | 예: 편조원단 제조업 |
| address | 주소 | VARCHAR(255) |  |  | N |  |  |
| latitude | 위도 | DECIMAL(10,7) |  |  | Y | NULL | 지도 표시용 |
| longitude | 경도 | DECIMAL(10,7) |  |  | Y | NULL | 지도 표시용 |
| data_source | 출처 | VARCHAR(100) |  |  | N |  | 공공데이터 이름·기준일 |
| created_at | 생성일 | TIMESTAMPTZ |  |  | N | NOW |  |

### 2.12 ai_registration_sessions (AI 등록 세션, MongoDB, 임시)

| 필드명 | 한글명 | 타입 | PK | FK | NULL | 기본값 | 설명 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| _id | 세션 ID | ObjectId | Y |  | N | AUTO | MongoDB 기본 키, 이름 고정 |
| seller_id | 판매자 ID | Long |  | (참조) | N |  | users |
| fabric_id | 원단 ID | Long |  | (참조) | Y | null | fabrics, 확정 후 연결 |
| sale_type | 판매 형태 | String |  |  | Y | null | SCRAP / ROLL, 첫 질문 답변 후 채움 |
| messages | 대화 기록 | Array |  |  | N | [] | {role, content, created_at} 목록 |
| ai_draft | AI 초안 | Object |  |  | Y | null | 지금까지 정리된 원단 정보 |
| final_data | 최종본 | Object |  |  | Y | null | 판매자가 수정·확정한 정보 |
| unconfirmed_fields | 미확인 항목 | Array |  |  | N | [] | 판매자 확인이 필요한 항목 |
| session_status | 세션 상태 | String |  |  | N | IN_PROGRESS | IN_PROGRESS / CONFIRMED / ABORTED |
| prompt_version | 프롬프트 버전 | String |  |  | N |  |  |
| ai_model | AI 모델 | String |  |  | N |  | Claude 모델명 |
| call_count | 호출 수 | Number |  |  | N | 0 | 비용 산정 |
| input_tokens | 입력 토큰 | Number |  |  | N | 0 | 비용 산정 |
| output_tokens | 출력 토큰 | Number |  |  | N | 0 | 비용 산정 |
| started_at | 시작 시각 | Date |  |  | N |  |  |
| last_updated_at | 마지막 갱신 | Date |  |  | N |  | 방치된 세션 정리(TTL, 확정 세션 제외) |

---

## 3. 관계 요약

| 관계 | 설명 |
| :---- | :---- |
| users 1 : 0..1 stores | 판매자는 매장 하나를 가진다 |
| stores 1 : N fabrics | 매장은 여러 원단을 등록한다 |
| fabrics 1 : 1 fabric_details | 원단마다 상세 정보 하나 |
| fabrics 1 : N fabric_images | 원단당 사진 1~3장 |
| fabrics 1 : N reservations | 원단 하나에 예약 여러 건(롤) |
| users 1 : N reservations | 구매자(buyer_id), 판매자(seller_id) |
| patterns 1 : N reservations | 도안을 고르고 한 예약(선택, NULL 허용) |
| patterns 1 : N pattern_parts | 도안 하나에 부품 여러 개 |
| users 1 : N favorites | 회원이 원단·도안을 관심 저장 |
| fabrics / patterns 1 : N favorites | target_type에 따라 한쪽만 연결 |
| fabrics 1 : N inquiries | 원단 하나에 문의 여러 건 |
| users 1 : N inquiries | 구매자(buyer_id), 판매자(seller_id) |
| users 1 : N ai_registration_sessions | MongoDB, 앱에서 연결 (임시) |
| fabrics 1 : 0..1 ai_registration_sessions | AI로 등록한 원단만 세션을 가진다 (임시) |

---

## 4. 제약 조건·인덱스

| 테이블 | 종류 | 내용 |
| :---- | :---- | :---- |
| users | UNIQUE (부분) | email, `WHERE deleted_at IS NULL` (탈퇴 회원의 이메일은 재가입 허용) |
| stores | UNIQUE | user_id (판매자당 매장 1개) |
| fabric_details | UNIQUE | fabric_id (원단당 상세 1개) |
| pattern_parts | FK ON DELETE CASCADE | pattern_id (도안 삭제 시 부품도 함께 삭제) |
| pattern_parts | CHECK | quantity ≥ 1 |
| fabrics | CHECK | reserved_length_cm ≤ remaining_length_cm |
| users | CHECK | role이 SELLER이면 seller_approval_status 필수, 아니면 NULL |
| fabrics | CHECK | sale_type이 ROLL이면 remaining_length_cm 필수, SCRAP이면 NULL |
| fabrics | CHECK | status가 REJECTED이면 reject_reason 필수 |
| fabric_details | CHECK | has_defect가 TRUE이면 defect_note 필수 |
| reservations | CHECK | status가 REJECTED이면 reject_reason 필수 |
| reservations | CHECK | requested_length_cm는 값이 있으면 90의 배수 |
| favorites | CHECK | target_type이 FABRIC이면 fabric_id만, PATTERN이면 pattern_id만 값이 있음 |
| favorites | UNIQUE | (user_id, fabric_id), (user_id, pattern_id) |
| users | CHECK | role은 SELLER / BUYER / ADMIN 중 하나 |
| fabrics | CHECK | sale_type은 SCRAP / ROLL, status는 PENDING / POSTED / REJECTED / SOLD_OUT 중 하나 |
| fabrics | CHECK | price ≥ 0, remaining_length_cm ≥ 0, reserved_length_cm ≥ 0 |
| fabric_details | CHECK | width_cm > 0, length_cm는 값이 있으면 30~90 (롤이면 NULL인지는 DB로 검사 불가, 앱에서 검사) |
| fabric_details | CHECK | material, thickness, color_family는 위 코드 목록 중 하나 |
| fabric_images | UNIQUE | (fabric_id, sort_order) — 대표 이미지(0번) 중복 방지 |
| fabric_images | CHECK | image_type은 값이 있으면 FULL / ZOOM / DEFECT 중 하나 |
| reservations | CHECK | status는 REQUESTED / ACCEPTED / REJECTED / CANCELED / PICKED_UP 중 하나 |
| reservations | CHECK | status가 CANCELED이면 canceled_by 필수 (BUYER / SELLER) |
| inquiries | CHECK | status는 WAITING / ANSWERED 중 하나, ANSWERED이면 answer 필수 |
| FK 전체 | ON DELETE | 따로 적지 않은 FK는 기본값(RESTRICT). 삭제는 deleted_at으로 처리하므로 실제 삭제는 없음 |
| fabrics | INDEX | (store_id) — 매장별 원단 조회 (FK) |
| fabric_images | INDEX | (fabric_id) — 원단별 사진 조회 (FK) |
| reservations | INDEX | (fabric_id) — 원단별 예약 조회 (FK) |
| pattern_parts | INDEX | (pattern_id) — 도안별 부품 조회 (FK) |
| reservations | INDEX | (seller_id, status), (buyer_id, status) — 예약 목록 조회 |
| inquiries | INDEX | (seller_id, status), (fabric_id) — 문의 관리·원단 상세 조회 |
| fabrics | INDEX | (status, sale_type) — 원단 목록·필터 |
| ai_registration_sessions | TTL INDEX | last_updated_at 기준 24시간 뒤 자동 삭제(확정 세션 제외) (임시) |
