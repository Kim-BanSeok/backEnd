Material Loop

API 명세서

양주시 자투리 원단 거래 웹 서비스

| 항목 | 내용 |
| --- | --- |
| 버전 | v0.3 (초안) |
| 작성일 | 2026-10-10 |
| API 수 | 48개 (필수 38, 선택 10) |
| 기본 주소 | /api/v1 |
| 기술 | Node.js + Express, PostgreSQL(관계형 데이터), MongoDB(AI 등록 세션) |

| 참고 / 응답 예시는 v0.2에서 이어받은 값이고, 바뀐 항목만 고쳤어요. 새 API(36~38)의 예시는 새로 썼어요. |
| --- |

# 1. 문서 안내

이 문서는 프론트엔드와 백엔드가 같은 약속으로 일하기 위한 API 명세서예요. 각 API의 주소, 권한, 요청 항목, 응답 예시, 처리 규칙, 오류 코드를 정리했어요.

읽는 방법

2장은 모든 API에 공통으로 적용되는 규칙(응답 형식, 인증, 날짜, 페이지, 코드값)이에요.

4장의 표에서 필요한 API를 찾고, 5장에서 상세를 확인해요.

"필수/선택"은 개발 우선순위예요. 필수 38개는 핵심 흐름(가입, 원단 등록·게시, 예약), 선택 9개는 관심저장·문의 등이에요.

요청 항목 표의 "필수/선택"은 그 항목을 꼭 보내야 하는지를 뜻해요.

변경 이력

| 버전 | 날짜 | 내용 |
| --- | --- | --- |
| v0.1 | - | 초안 (이전 API 명세서) |
| v0.2 | 2026-10-10 | 구현과 자동 테스트로 확인한 동작을 기준으로 다시 정리. 응답 예시를 실제 호출 결과로 교체, 처리 규칙과 오류 조건 보강 |
| v0.3 | 2026-10-10 | DB 설계 변경 반영, 판매자 승인 추가 (아래 "v0.3 변경 내용") |

v0.3 변경 내용

| 구분 | 관련 API | 내용 |
| --- | --- | --- |
| 삭제 | 2.5, 2.8, 9, 11, 20, 33 | 등록 방식·시간(register_method, register_started_at, register_completed_at) 요청·응답 항목 삭제 |
| 추가 | 1, 2, 9, 17, 20, 36~38, 3장, 6.1, 6.5, 7장 | 판매자 승인: 운영팀의 판매자 목록·승인·거절 API 3개 추가. 승인되지 않은 판매자는 원단 등록 불가(SELLER_NOT_APPROVED). 로그인 응답에 seller_approval_status 추가. API 44개 → 47개 |
| 번호 변경 | 39~47 | 관심·문의 API 번호 36~44 → 39~47 (판매자 승인 API를 운영 절에 넣으면서) |
| 이름 변경 | 22, 23 | 도안 alias → aliases, reviewer → reviewed_by. category 최대 20자 → 50자 |
| 이름 변경 | 43, 44 | 문의 응답 inquirer_nickname → buyer_nickname |
| 기본값 | 9, 20 | detail.material 을 선택 항목으로 바꾸고, 보내지 않으면 UNKNOWN |
| 삭제 | 5 | 매장 정보를 예약 수락 뒤에만 보여 준다는 규칙 삭제. 매장 정보는 처음부터 공개 |
| 삭제 | 28, 31 | 예약 취소 사유(reason) 삭제. canceled_by, canceled_at 만 기록 |
| 명시 | 19 | 마 단위 답변은 cm로 바꿔 저장 (3마 → 270) |
| 명시 | 24 | 추천 판정 공식(자투리 한 줄 배치·회전 없음, 롤 90cm 단위 올림), 판정 근거 값, 자투리 필요 면적. 응답 예시를 공식대로 다시 계산 |
| 명시 | 12, 25 | 예상 금액은 예약 요청 시점 가격으로 고정. 판매자가 가격을 바꿔도 이미 요청된 예약은 그대로 |
| 명시 | 17~19 | next_question 은 저장하지 않고 서버가 세션 값으로 계산 |
| 변경 | 6.4 | AI 세션 자동 삭제 7일 → 24시간 (임시) |
| 추가 | 7장, 48 | factories(공장 리스트, 임시)를 대응표에 추가. 공장 목록 조회(48)에서 생산품을 업종 카테고리로 묶어 본다 |

# 2. 공통 규칙

## 2.1 기본 형식

| 항목 | 규칙 |
| --- | --- |
| 기본 주소 | /api/v1 (이 문서의 URL은 이 주소 아래의 경로예요. 이미지는 예외로 /uploads/... 또는 저장소 주소) |
| 데이터 형식 | 요청·응답 모두 JSON (UTF-8). 사진 업로드만 multipart/form-data |
| 인증 헤더 | Authorization: Bearer <액세스 토큰> |
| CORS | 서버가 허용한 프론트엔드 주소(Vercel)만 호출할 수 있어요 |
| HTTPS | 운영에서는 HTTPS만 사용해요 |

## 2.2 응답 형식

성공과 실패 모두 같은 틀로 응답해요. 프론트엔드는 success 값으로 먼저 나눠서 처리해요.

성공

{

"success": true,

"data": { ... }

}

실패

{

"success": false,

"error": {

"code": "VALIDATION_ERROR",

"message": "입력값을 확인해 주세요",

"details": [

{

"field": "email",

"message": "이메일 형식이 올바르지 않아요"

},

{

"field": "password",

"message": "비밀번호는 8자 이상이어야 해요"

},

{

"field": "nickname",

"message": "닉네임을 입력해 주세요"

}

]

}

}

error.code 로 분기하고, error.message 는 사용자에게 그대로 보여줘도 되는 한글이에요.

입력값 오류(VALIDATION_ERROR)에는 error.details 에 { field, message } 목록이 함께 와요. 입력칸 옆에 이유를 보여줄 수 있어요.

삭제, 상태 변경처럼 돌려줄 내용이 없는 성공은 200 과 { "success": true, "data": null } 이에요.

## 2.3 인증과 권한

| 표기 | 뜻 |
| --- | --- |
| 공개 | 로그인하지 않아도 호출할 수 있어요. |
| 로그인 | 로그인한 모든 사용자가 호출할 수 있어요. |
| SELLER / BUYER / ADMIN | 해당 역할만 호출할 수 있어요. 다른 역할은 403 FORBIDDEN 이에요. |
| 공개 (로그인하면 더 많이 보임) | 토큰이 없어도 호출할 수 있고, 판매자 본인·운영팀이 호출하면 더 많은 정보가 와요 (원단 상세, 문의 목록). |

토큰 유효기간은 24시간이에요. 리프레시 토큰은 없고, 만료되면 401 UNAUTHORIZED 가 와요. 다시 로그인해요.

잘못된 토큰을 보내면 공개 API라도 401 이에요.

운영팀(ADMIN) 계정은 가입 API로 만들 수 없고, 운영팀이 직접 만들어요.

역할이 맞아도 내 데이터가 아니면(남의 원단·예약·문의) 403 FORBIDDEN 이에요.

## 2.4 이름 규칙

식별자는 camelCase 예요: userId, storeId, fabricId, imageId, reservationId, patternId, favoriteId, inquiryId, sessionId.

그 밖의 데이터 항목은 ERD 컬럼 이름 그대로 snake_case 예요: sale_type, remaining_length_cm, thumbnail_url.

토큰 응답은 accessToken, expiresIn 이에요.

## 2.5 날짜와 시간

응답은 한국 시간 ISO 8601 문자열이에요. 예: 2026-10-14T15:00:00+09:00

요청의 pickup_at 은 ISO 8601 이에요. 시간대는 +09:00 또는 Z(UTC) 모두 받아요.

## 2.6 페이지 나누기

목록 API는 모두 같은 방식이에요.

| 요청 쿼리 | 설명 |
| --- | --- |
| page | 페이지 번호. 0부터 시작해요. 기본 0 |
| size | 한 페이지 개수. 기본 20, 최대 50. 범위를 벗어나면 VALIDATION_ERROR |

응답 data 모양

{

"content": [ ... ],

"page": 0,

"size": 20,

"totalElements": 135,

"totalPages": 7

}

## 2.7 단위

길이는 cm 정수예요. 롤은 1마 = 90cm 단위로 사고팔아요.

가격은 원 단위 정수예요. 자투리는 장당, 롤은 90cm(1마)당 가격이에요.

## 2.8 코드값 (enum)

요청과 응답 모두 영문 코드를 그대로 써요. 한글 표시는 프론트엔드에서 바꿔요.

| 항목 | 값 |
| --- | --- |
| sale_type (판매 형태) | SCRAP(자투리), ROLL(롤) |
| material (소재) | COTTON(면), LINEN(린넨), POLYESTER(폴리에스터), NYLON(나일론), RAYON(레이온), WOOL(울), BLEND(혼방), ETC(기타), UNKNOWN(모름) |
| thickness (두께) | THIN(얇음), NORMAL(보통), THICK(두꺼움) |
| color_family (색상 계열) | WHITE, BLACK, GRAY, BEIGE, BROWN, RED, PINK, YELLOW, GREEN, BLUE, NAVY, PURPLE, MIXED |
| 원단 status | PENDING(게시 대기), POSTED(게시 중), REJECTED(반려), SOLD_OUT(판매 완료) |
| image_type (사진 종류) | FULL(전체), ZOOM(확대), DEFECT(하자) |
| 예약 status | REQUESTED(요청됨), ACCEPTED(수락됨), REJECTED(거절됨), CANCELED(취소됨), PICKED_UP(수령완료) |
| canceled_by | BUYER, SELLER |
| role (역할) | SELLER, BUYER, ADMIN |
| seller_approval_status | PENDING, APPROVED, REJECTED (판매자만) |
| target_type (관심저장) | FABRIC, PATTERN |
| 문의 status | WAITING(답변 대기), ANSWERED(답변 완료) |
| AI 세션 session_status | IN_PROGRESS(진행 중), CONFIRMED(확정), ABORTED(중단) |
| 추천 judgement | SUITABLE(적합), NEEDS_CHECK(확인 필요) |
| factory category (공장 업종) | TEXTILE(섬유·원단), APPAREL(의류·봉제), LEATHER(피혁), FOOD(식품), CHEMICAL(화학), PLASTIC(플라스틱), METAL(금속·기계), WOOD(목재·가구), PAPER(종이·인쇄), ELECTRIC(전기·전자), CONSTRUCTION(건설자재), OTHER(기타) |

# 3. 오류 코드

오류는 HTTP 상태 코드와 error.code 로 알려줘요. 같은 상태 코드 안에서도 code 로 이유를 구분해요.

| HTTP | 코드 | 메시지 (error.message) | 언제 나오나요 |
| --- | --- | --- | --- |
| 400 | VALIDATION_ERROR | 입력값을 확인해 주세요 | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | AGREEMENT_REQUIRED | 약관과 개인정보 처리에 동의해 주세요 | privacy_agreed 또는 terms_agreed 가 true 가 아니에요. |
| 400 | SCRAP_LENGTH_OUT_OF_RANGE | 자투리는 길이 30~90cm만 등록할 수 있어요 | 자투리인데 length_cm 가 30~90cm 가 아니거나 없어요. |
| 400 | ROLL_LENGTH_REQUIRED | 롤은 남은 길이를 90cm 이상 입력해 주세요 | 롤인데 remaining_length_cm 가 없거나 90cm 미만이에요. |
| 400 | DEFECT_NOTE_REQUIRED | 하자 위치와 내용을 적어 주세요 | has_defect 가 true 인데 defect_note 가 없어요. |
| 400 | LENGTH_NOT_MULTIPLE_OF_90 | 1마(90cm) 단위로 골라 주세요 | 롤의 requested_length_cm 가 90의 배수가 아니에요. |
| 400 | IMAGE_LIMIT_EXCEEDED | 사진은 3장까지 올릴 수 있어요 | 이미 사진이 3장이에요. |
| 400 | IMAGE_TOO_LARGE | 5MB 이하의 jpg·png·webp만 올릴 수 있어요 | 5MB 를 넘거나 jpg, png, webp 가 아니에요. |
| 400 | IMAGE_REQUIRED | 사진이 없는 원단은 게시할 수 없어요 | 사진이 한 장도 없는 원단은 승인할 수 없어요. |
| 401 | UNAUTHORIZED | 다시 로그인해 주세요 | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 401 | LOGIN_FAILED | 이메일 또는 비밀번호가 맞지 않아요 | 이메일 또는 비밀번호가 맞지 않아요. |
| 403 | FORBIDDEN | 권한이 없어요 | 역할이 다르거나 내 데이터가 아니에요. |
| 403 | SELLER_NOT_APPROVED | 판매자 승인 후 원단을 등록할 수 있어요 | 운영팀이 아직 판매자를 승인하지 않았거나 거절했어요. |
| 403 | STORE_REQUIRED | 매장 정보를 먼저 등록해 주세요 | 판매자가 매장을 아직 등록하지 않았어요. |
| 404 | NOT_FOUND | 찾을 수 없어요 | 없거나 볼 수 없는 데이터예요. |
| 409 | EMAIL_DUPLICATED | 이미 가입한 이메일이에요 | 이미 가입한 이메일이에요. |
| 409 | STORE_ALREADY_EXISTS | 이미 매장을 등록했어요 | 이미 매장을 등록했어요. |
| 409 | FABRIC_NOT_AVAILABLE | 지금은 구매할 수 없는 원단이에요 | 게시 중이 아니거나 판매 완료된 원단이에요. |
| 409 | SCRAP_ALREADY_RESERVED | 이미 예약 중인 원단이에요 | 자투리에 이미 수락된 예약이 있어요. |
| 409 | INSUFFICIENT_LENGTH | 구매 가능한 길이가 부족해요 | 구매 가능 길이(남은 길이 - 확보 길이)가 부족해요. 수정 시에는 확보한 길이보다 줄일 수 없어요. |
| 409 | DUPLICATE_RESERVATION | 이미 이 원단을 예약했어요 | 같은 원단에 이미 요청됨·수락됨 예약이 있어요. |
| 409 | FABRIC_HAS_ACTIVE_RESERVATION | 진행 중인 예약이 있어 삭제할 수 없어요 | 요청됨·수락됨 예약이 있는 원단이에요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없어요 | 지금 상태에서는 할 수 없는 동작이에요. |
| 409 | AI_SESSION_CLOSED | 이미 끝난 등록이에요 | 이미 확정되거나 중단된 세션이에요. |
| 409 | FAVORITE_DUPLICATED | 이미 관심 목록에 있어요 | 이미 관심 목록에 있어요. |
| 429 | TOO_MANY_REQUESTS | 요청이 너무 많아요. 잠시 후 다시 시도해 주세요 | 로그인·가입을 너무 자주 시도했어요(15분에 20번). |
| 503 | AI_UNAVAILABLE | AI 연결이 어려워요. 직접 입력으로 계속해 주세요 | AI 응답이 실패했어요(1회 다시 시도한 뒤에도). 직접 입력으로 계속하게 안내해요. |
| 500 | INTERNAL_ERROR | 잠시 후 다시 시도해 주세요 | 서버 내부 오류예요. 자세한 내용은 서버 기록에만 남아요. |

TOO_MANY_REQUESTS(429)는 로그인 시도 제한을 위해 이전 초안에 없던 코드를 더한 거예요.

# 4. API 목록

/api/v1 아래의 경로예요. "구분"의 필수는 핵심 흐름, 선택은 부가 기능이에요.

| No | 영역 | Method | URL | 권한 | 구분 | 이름 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 회원 | POST | /auth/signup | 공개 | 필수 | 회원가입 |
| 2 | 회원 | POST | /auth/login | 공개 | 필수 | 로그인 |
| 3 | 회원 | GET | /users/me | 로그인 | 필수 | 내 정보 조회 |
| 4 | 회원 | PATCH | /users/me | 로그인 | 필수 | 내 정보 수정 |
| 5 | 매장 | POST | /stores | SELLER | 필수 | 매장 등록 |
| 6 | 매장 | GET | /stores/me | SELLER | 필수 | 내 매장 조회 |
| 7 | 매장 | PATCH | /stores/me | SELLER | 필수 | 내 매장 수정 |
| 8 | 매장 | GET | /stores/{storeId} | 공개 | 필수 | 매장 정보 조회 |
| 9 | 원단 | POST | /fabrics | SELLER | 필수 | 원단 등록 (직접 입력) |
| 10 | 원단 | GET | /fabrics | 공개 | 필수 | 원단 목록 조회 |
| 11 | 원단 | GET | /fabrics/{fabricId} | 공개 | 필수 | 원단 상세 조회 |
| 12 | 원단 | PATCH | /fabrics/{fabricId} | SELLER(본인) | 필수 | 원단 수정 |
| 13 | 원단 | DELETE | /fabrics/{fabricId} | SELLER(본인) | 필수 | 원단 삭제 |
| 14 | 원단 | GET | /sellers/me/fabrics | SELLER | 필수 | 내 원단 목록 조회 |
| 15 | 원단 | POST | /fabrics/{fabricId}/images | SELLER(본인) | 필수 | 원단 사진 업로드 |
| 16 | 원단 | DELETE | /fabrics/{fabricId}/images/{imageId} | SELLER(본인) | 필수 | 원단 사진 삭제 |
| 17 | AI 등록 | POST | /ai-sessions | SELLER | 필수 | AI 등록 시작 |
| 18 | AI 등록 | GET | /ai-sessions/{sessionId} | SELLER(본인) | 필수 | AI 등록 세션 조회 |
| 19 | AI 등록 | POST | /ai-sessions/{sessionId}/answers | SELLER(본인) | 필수 | AI 등록 답변 보내기 |
| 20 | AI 등록 | POST | /ai-sessions/{sessionId}/confirm | SELLER(본인) | 필수 | AI 등록 확정 |
| 21 | AI 등록 | POST | /ai-sessions/{sessionId}/abort | SELLER(본인) | 필수 | AI 등록 중단 |
| 22 | 도안 | GET | /patterns | 공개 | 필수 | 도안 목록 조회 |
| 23 | 도안 | GET | /patterns/{patternId} | 공개 | 필수 | 도안 상세 조회 |
| 24 | 추천 | GET | /fabrics/{fabricId}/recommendations | 공개 | 필수 | 원단 기준 도안 추천 |
| 25 | 예약 | POST | /reservations | BUYER | 필수 | 예약 요청 |
| 26 | 예약 | GET | /reservations/me | BUYER | 필수 | 내 예약 목록 (구매자) |
| 27 | 예약 | GET | /sellers/me/reservations | SELLER | 필수 | 받은 예약 목록 (판매자) |
| 28 | 예약 | GET | /reservations/{reservationId} | 당사자 | 필수 | 예약 상세 조회 |
| 29 | 예약 | POST | /reservations/{reservationId}/accept | SELLER(본인) | 필수 | 예약 수락 |
| 30 | 예약 | POST | /reservations/{reservationId}/reject | SELLER(본인) | 필수 | 예약 거절 |
| 31 | 예약 | POST | /reservations/{reservationId}/cancel | 당사자 | 필수 | 예약 취소 |
| 32 | 예약 | POST | /reservations/{reservationId}/pickup | SELLER(본인) | 필수 | 수령 확인 |
| 33 | 운영 | GET | /admin/fabrics | ADMIN | 필수 | 게시 대기 원단 목록 (운영팀) |
| 34 | 운영 | POST | /admin/fabrics/{fabricId}/approve | ADMIN | 필수 | 게시 승인 |
| 35 | 운영 | POST | /admin/fabrics/{fabricId}/reject | ADMIN | 필수 | 게시 반려 |
| 36 | 운영 | GET | /admin/sellers | ADMIN | 필수 | 판매자 목록 (운영팀) |
| 37 | 운영 | POST | /admin/sellers/{userId}/approve | ADMIN | 필수 | 판매자 승인 |
| 38 | 운영 | POST | /admin/sellers/{userId}/reject | ADMIN | 필수 | 판매자 거절 |
| 39 | 관심 | POST | /favorites | 로그인 | 선택 | 관심저장 추가 |
| 40 | 관심 | GET | /favorites/me | 로그인 | 선택 | 내 관심 목록 |
| 41 | 관심 | DELETE | /favorites/{favoriteId} | 로그인(본인) | 선택 | 관심저장 삭제 |
| 42 | 문의 | POST | /fabrics/{fabricId}/inquiries | BUYER | 선택 | 문의 작성 |
| 43 | 문의 | GET | /fabrics/{fabricId}/inquiries | 공개 | 선택 | 원단 문의 목록 |
| 44 | 문의 | GET | /sellers/me/inquiries | SELLER | 선택 | 받은 문의 목록 (판매자) |
| 45 | 문의 | POST | /inquiries/{inquiryId}/answer | SELLER(본인) | 선택 | 문의 답변 |
| 46 | 문의 | PATCH | /inquiries/{inquiryId} | BUYER(본인) | 선택 | 문의 수정 |
| 47 | 문의 | DELETE | /inquiries/{inquiryId} | BUYER(본인) | 선택 | 문의 삭제 |
| 48 | 공장 | GET | /factories | 공개 | 선택 | 공장 목록 조회 |

# 5. API 상세

## 5.1 회원

### 1. 회원가입

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/auth/signup |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 판매자 또는 구매자로 가입해요. 운영팀(ADMIN) 계정은 이 API로 만들 수 없어요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| email | 문자열 | 필수 | 이메일 (소문자로 저장) / 최대 255자 |
| password | 문자열 | 필수 | 비밀번호 (8~72자) / 최소 8자, 최대 72자 |
| nickname | 문자열 | 필수 | 닉네임 / 최소 1자, 최대 50자 |
| role | 문자열 | 필수 | 역할 (SELLER 또는 BUYER) / 값: SELLER, BUYER |
| phone_number | 문자열 또는 null | 선택 | 전화번호 / 최대 20자 |
| privacy_agreed | true/false | 필수 | 개인정보 처리 동의 (true 여야 함) |
| terms_agreed | true/false | 필수 | 이용약관 동의 (true 여야 함) |

요청 예시

{

"email": "seller@example.com",

"password": "password123",

"nickname": "양주원단",

"role": "SELLER",

"phone_number": "010-1234-5678",

"privacy_agreed": true,

"terms_agreed": true

}

성공 응답 (201)

{

"success": true,

"data": {

"userId": 2,

"role": "SELLER"

}

}

처리 규칙

이메일은 앞뒤 공백을 지우고 소문자로 저장해요. 대소문자만 다른 이메일도 중복으로 봐요.

비밀번호는 8~72자이고 암호화(bcrypt)해서 저장해요.

privacy_agreed, terms_agreed 가 둘 다 true 여야 가입돼요.

판매자(SELLER)는 seller_approval_status 가 PENDING 으로 시작하고, 구매자는 null 이에요.

판매자는 운영팀이 승인(APPROVED)해야 원단을 등록할 수 있어요.

같은 주소에서 15분에 20번까지만 시도할 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | AGREEMENT_REQUIRED | privacy_agreed 또는 terms_agreed 가 true 가 아니에요. |
| 409 | EMAIL_DUPLICATED | 이미 가입한 이메일이에요. |
| 429 | TOO_MANY_REQUESTS | 로그인·가입을 너무 자주 시도했어요(15분에 20번). |

### 2. 로그인

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/auth/login |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 이메일과 비밀번호로 로그인하고 액세스 토큰을 받아요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| email | 문자열 | 필수 | 이메일 (소문자로 저장) / 최소 1자 |
| password | 문자열 | 필수 | 비밀번호 (8~72자) / 최소 1자 |

요청 예시

{

"email": "seller@example.com",

"password": "password123"

}

성공 응답 (200)

{

"success": true,

"data": {

"accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",

"expiresIn": 86400,

"user": {

"userId": 2,

"nickname": "양주원단",

"role": "SELLER",

"seller_approval_status": "PENDING",

"hasStore": false

}

}

}

처리 규칙

토큰 유효기간은 24시간(expiresIn: 86400초)이고 리프레시 토큰은 없어요. 만료되면 다시 로그인해요.

이메일이 틀렸는지 비밀번호가 틀렸는지 알려 주지 않아요.

user.hasStore 가 false 인 판매자는 매장 등록 화면으로 보내요.

user.seller_approval_status 가 APPROVED 가 아닌 판매자는 승인 대기 안내를 보여줘요. 구매자·운영팀은 null 이에요.

15분에 20번까지만 시도할 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 401 | LOGIN_FAILED | 이메일 또는 비밀번호가 맞지 않아요. |
| 429 | TOO_MANY_REQUESTS | 로그인·가입을 너무 자주 시도했어요(15분에 20번). |

### 3. 내 정보 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/users/me |
| 권한 | 로그인 |
| 구분 | 필수 |
| 설명 | 로그인한 사용자의 정보를 보여줘요. |

요청

요청 항목이 없어요. (로그인 토큰만 필요해요)

성공 응답 (200)

{

"success": true,

"data": {

"userId": 2,

"email": "seller@example.com",

"nickname": "양주원단",

"role": "SELLER",

"phone_number": "010-1234-5678",

"seller_approval_status": "PENDING",

"hasStore": false,

"created_at": "2026-10-10T17:31:30+09:00"

}

}

처리 규칙

hasStore 는 매장을 등록했는지 여부예요.

seller_approval_status 는 판매자만 값이 있고, 구매자는 null 이에요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |

### 4. 내 정보 수정

| 항목 | 내용 |
| --- | --- |
| Method / URL | PATCH /api/v1/users/me |
| 권한 | 로그인 |
| 구분 | 필수 |
| 설명 | 닉네임과 전화번호를 바꿔요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| nickname | 문자열 | 선택 | 닉네임 / 최소 1자, 최대 50자 |
| phone_number | 문자열 또는 null | 선택 | 전화번호 / 최대 20자 |

요청 예시

{

"nickname": "양주원단상회",

"phone_number": "010-1234-5678"

}

성공 응답 (200)

{

"success": true,

"data": {

"userId": 2,

"email": "seller@example.com",

"nickname": "양주원단상회",

"role": "SELLER",

"phone_number": "010-1234-5678",

"seller_approval_status": "PENDING",

"hasStore": false,

"created_at": "2026-10-10T17:31:30+09:00"

}

}

처리 규칙

보낸 항목만 바뀌어요. 하나 이상 보내야 해요.

이메일과 역할은 바꿀 수 없어요. 보내면 VALIDATION_ERROR 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

## 5.2 매장

### 5. 매장 등록

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/stores |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 자기 매장을 등록해요. 원단 등록 전에 먼저 해야 해요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| store_name | 문자열 | 필수 | 매장 이름 / 최소 1자, 최대 100자 |
| store_address | 문자열 | 필수 | 매장 주소 / 최소 1자, 최대 255자 |
| store_phone | 문자열 | 필수 | 매장 전화번호 / 최소 1자, 최대 20자 |
| closed_days | 문자열 또는 null | 선택 | 휴무일 / 최대 100자 |
| pickup_guide | 문자열 또는 null | 선택 | 픽업 안내 / 최대 5000자 |

요청 예시

{

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

성공 응답 (201)

{

"success": true,

"data": {

"storeId": 1

}

}

처리 규칙

판매자 한 명당 매장은 1개예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | STORE_ALREADY_EXISTS | 이미 매장을 등록했어요. |

### 6. 내 매장 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/stores/me |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 자기 매장 정보를 봐요. |

요청

요청 항목이 없어요. (로그인 토큰만 필요해요)

성공 응답 (200)

{

"success": true,

"data": {

"storeId": 1,

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

}

처리 규칙

매장을 아직 등록하지 않았으면 404 NOT_FOUND 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

### 7. 내 매장 수정

| 항목 | 내용 |
| --- | --- |
| Method / URL | PATCH /api/v1/stores/me |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 자기 매장 정보를 고쳐요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| store_name | 문자열 | 선택 | 매장 이름 / 최소 1자, 최대 100자 |
| store_address | 문자열 | 선택 | 매장 주소 / 최소 1자, 최대 255자 |
| store_phone | 문자열 | 선택 | 매장 전화번호 / 최소 1자, 최대 20자 |
| closed_days | 문자열 또는 null | 선택 | 휴무일 / 최대 100자 |
| pickup_guide | 문자열 또는 null | 선택 | 픽업 안내 / 최대 5000자 |

요청 예시

{

"closed_days": "매주 일요일, 공휴일"

}

성공 응답 (200)

{

"success": true,

"data": {

"storeId": 1,

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일, 공휴일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

}

처리 규칙

보낸 항목만 바뀌어요. 하나 이상 보내야 해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

### 8. 매장 정보 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/stores/{storeId} |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 누구나 매장 정보를 볼 수 있어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| storeId | 정수 | 필수 | 매장 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"storeId": 1,

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일, 공휴일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

}

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.3 원단

### 9. 원단 등록 (직접 입력)

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/fabrics |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 원단을 직접 입력해서 등록해요. 등록하면 게시 대기(PENDING)가 되고, 운영팀이 승인해야 구매자에게 보여요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sale_type | 문자열 | 필수 | 판매 형태 (SCRAP: 자투리, ROLL: 롤) / 값: SCRAP, ROLL |
| title | 문자열 | 필수 | 제목 / 최소 1자, 최대 100자 |
| price | 정수 | 필수 | 가격(원). 자투리는 장당, 롤은 90cm당 / 최소 1 |
| remaining_length_cm | 정수 또는 null | 선택 | 롤의 남은 길이(cm). 롤만, 90 이상 |
| detail | 객체 | 필수 | 원단상세 |
| detail.material | 문자열 | 선택 | 소재 / 값: COTTON, LINEN, POLYESTER, NYLON, RAYON, WOOL, BLEND, ETC, UNKNOWN. 보내지 않으면 UNKNOWN |
| detail.thickness | 문자열 | 필수 | 두께 / 값: THIN, NORMAL, THICK |
| detail.color_family | 문자열 | 필수 | 색상 계열 / 값: WHITE, BLACK, GRAY, BEIGE, BROWN, RED, PINK, YELLOW, GREEN, BLUE, NAVY, PURPLE, MIXED |
| detail.color_detail | 문자열 또는 null | 선택 | 색상 설명 / 최대 100자 |
| detail.width_cm | 정수 | 필수 | 가로(폭) cm / 최소 1, 최대 1000 |
| detail.length_cm | 정수 또는 null | 선택 | 세로 길이 cm. 자투리만, 30~90 |
| detail.has_defect | true/false | 선택 | 하자 여부 (기본 false) |
| detail.defect_note | 문자열 또는 null | 선택 | 하자 위치와 내용. has_defect 가 true 이면 필수 / 최대 255자 |
| detail.blend_ratio | 문자열 또는 null | 선택 | 혼방 비율 / 최대 100자 |
| detail.weave | 문자열 또는 null | 선택 | 직조 / 최대 50자 |
| detail.grain_direction | 문자열 또는 null | 선택 | 결 방향 / 최대 50자 |
| detail.description | 문자열 또는 null | 선택 | 설명 / 최대 5000자 |

요청 예시 (자투리)

{

"sale_type": "SCRAP",

"title": "네이비 면 20수",

"price": 3000,

"remaining_length_cm": null,

"detail": {

"material": "COTTON",

"thickness": "NORMAL",

"color_family": "NAVY",

"color_detail": "짙은 남색",

"width_cm": 150,

"length_cm": 65,

"has_defect": true,

"defect_note": "오른쪽 아래 얼룩 3cm",

"description": "앞치마용으로 쓰던 원단이에요"

}

}

요청 예시 (롤)

{

"sale_type": "ROLL",

"title": "린넨 롤",

"price": 6000,

"remaining_length_cm": 900,

"detail": {

"material": "LINEN",

"thickness": "NORMAL",

"color_family": "BEIGE",

"width_cm": 150,

"length_cm": null,

"has_defect": false

}

}

성공 응답 (201)

{

"success": true,

"data": {

"fabricId": 1,

"status": "PENDING"

}

}

처리 규칙

자투리(SCRAP): detail.length_cm 은 30~90cm 이고, remaining_length_cm 은 보내지 않아요.

롤(ROLL): remaining_length_cm 은 90cm 이상이고, detail.length_cm 은 보내지 않아요.

has_defect 가 true 이면 defect_note(하자 위치와 내용)가 꼭 필요해요.

material, thickness, color_family 는 코드값 목록 안에서만 보낼 수 있어요. 소재를 모르면 UNKNOWN 을 보내거나 비워 두면 UNKNOWN 으로 저장해요.

원단정보와 원단상세는 한 번에 저장해요. 둘 다 성공하거나 둘 다 실패해요.

사진은 등록한 뒤에 따로 올려요(최대 3장).

승인된 판매자(seller_approval_status 가 APPROVED)만 등록할 수 있어요. 아니면 SELLER_NOT_APPROVED 예요. 승인을 먼저 확인하고, 그다음 매장을 확인해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 403 | SELLER_NOT_APPROVED | 판매자 승인 전이거나 승인이 거절됐어요. |
| 403 | STORE_REQUIRED | 판매자가 매장을 아직 등록하지 않았어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | SCRAP_LENGTH_OUT_OF_RANGE | 자투리인데 length_cm 가 30~90cm 가 아니거나 없어요. |
| 400 | ROLL_LENGTH_REQUIRED | 롤인데 remaining_length_cm 가 없거나 90cm 미만이에요. |
| 400 | DEFECT_NOTE_REQUIRED | has_defect 가 true 인데 defect_note 가 없어요. |

### 10. 원단 목록 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/fabrics |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 게시 중(POSTED)인 원단 목록을 누구나 볼 수 있어요. 자투리와 롤을 탭처럼 나눠서 조회해요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sale_type | 문자열 | 선택 | 판매 형태 (SCRAP: 자투리, ROLL: 롤) / 값: SCRAP, ROLL, 기본값 SCRAP |
| material | 문자열 | 선택 | 소재 (쉼표로 여러 개) |
| thickness | 문자열 | 선택 | 두께 (쉼표로 여러 개) |
| color_family | 문자열 | 선택 | 색상 계열 (쉼표로 여러 개) |
| keyword | 문자열 | 선택 | 검색어 / 최대 100자 |
| sort | 문자열 | 선택 | 정렬 / 값: latest, price_asc, price_desc, 기본값 latest |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"fabricId": 1,

"title": "네이비 면 20수",

"sale_type": "SCRAP",

"price": 3500,

"material": "COTTON",

"thickness": "NORMAL",

"color_family": "NAVY",

"width_cm": 150,

"length_cm": 65,

"available_length_cm": null,

"is_reserved": false,

"has_defect": true,

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"store_name": "양주원단상회"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

sale_type 을 보내지 않으면 SCRAP 이에요.

material, thickness, color_family 는 쉼표로 여러 개를 이어서 보낼 수 있어요 (예: COTTON,LINEN).

keyword 는 제목에서 찾아요.

sort: latest(기본, 최신순), price_asc(낮은 가격순), price_desc(높은 가격순).

예약 중인 자투리도 목록에 남고 is_reserved 가 true 예요. 판매 완료·삭제된 원단은 나오지 않아요.

롤은 available_length_cm 가 구매 가능 길이(남은 길이 - 확보 길이)이고, 자투리는 null 이에요.

thumbnail_url 은 대표 사진(sort_order 0)의 썸네일이에요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 11. 원단 상세 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/fabrics/{fabricId} |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 원단 정보, 상세, 사진, 매장, 구매 가능 정보를 한 번에 줘요. 로그인하지 않아도 볼 수 있어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"fabricId": 1,

"title": "네이비 면 20수",

"sale_type": "SCRAP",

"price": 3500,

"status": "POSTED",

"detail": {

"material": "COTTON",

"thickness": "NORMAL",

"color_family": "NAVY",

"color_detail": "짙은 남색(네이비)",

"width_cm": 150,

"length_cm": 65,

"has_defect": true,

"defect_note": "오른쪽 아래 얼룩 3cm",

"blend_ratio": null,

"weave": null,

"grain_direction": null,

"description": "앞치마용으로 쓰던 원단이에요"

},

"images": [

{

"imageId": 1,

"image_url": "https://api.example.com/uploads/fabrics/1/bb282f0f-5a33-4177-8179-472c97919a95.png",

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"image_type": "FULL",

"sort_order": 0

}

],

"store": {

"storeId": 1,

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일, 공휴일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

},

"availability": {

"is_reserved": false,

"available_length_cm": null,

"reserved_length_cm": null

},

"created_at": "2026-10-10T17:31:31+09:00"

}

}

처리 규칙

구매자와 로그인하지 않은 사용자는 게시 중(POSTED)인 원단만 볼 수 있어요. 나머지 상태는 404 예요.

판매자 본인과 운영팀은 모든 상태를 볼 수 있고, reject_reason, remaining_length_cm 도 함께 받아요.

availability: is_reserved(수락된 예약이 있는지), available_length_cm(롤의 구매 가능 길이), reserved_length_cm(롤의 확보 길이).

삭제된 원단은 누구에게나 404 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

### 12. 원단 수정

| 항목 | 내용 |
| --- | --- |
| Method / URL | PATCH /api/v1/fabrics/{fabricId} |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 자기 원단을 고쳐요. 보낸 항목만 바뀌어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sale_type | 문자열 | 선택 | 판매 형태 (SCRAP: 자투리, ROLL: 롤) / 값: SCRAP, ROLL |
| title | 문자열 | 선택 | 제목 / 최소 1자, 최대 100자 |
| price | 정수 | 선택 | 가격(원). 자투리는 장당, 롤은 90cm당 / 최소 1 |
| remaining_length_cm | 정수 또는 null | 선택 | 롤의 남은 길이(cm). 롤만, 90 이상 |
| detail | 객체 | 선택 | 원단상세 |
| detail.material | 문자열 | 선택 | 소재 / 값: COTTON, LINEN, POLYESTER, NYLON, RAYON, WOOL, BLEND, ETC, UNKNOWN |
| detail.thickness | 문자열 | 선택 | 두께 / 값: THIN, NORMAL, THICK |
| detail.color_family | 문자열 | 선택 | 색상 계열 / 값: WHITE, BLACK, GRAY, BEIGE, BROWN, RED, PINK, YELLOW, GREEN, BLUE, NAVY, PURPLE, MIXED |
| detail.color_detail | 문자열 또는 null | 선택 | 색상 설명 / 최대 100자 |
| detail.width_cm | 정수 | 선택 | 가로(폭) cm / 최소 1, 최대 1000 |
| detail.length_cm | 정수 또는 null | 선택 | 세로 길이 cm. 자투리만, 30~90 |
| detail.has_defect | true/false | 선택 | 하자 여부 (기본 false) |
| detail.defect_note | 문자열 또는 null | 선택 | 하자 위치와 내용. has_defect 가 true 이면 필수 / 최대 255자 |
| detail.blend_ratio | 문자열 또는 null | 선택 | 혼방 비율 / 최대 100자 |
| detail.weave | 문자열 또는 null | 선택 | 직조 / 최대 50자 |
| detail.grain_direction | 문자열 또는 null | 선택 | 결 방향 / 최대 50자 |
| detail.description | 문자열 또는 null | 선택 | 설명 / 최대 5000자 |

요청 예시

{

"price": 3500,

"detail": {

"color_detail": "짙은 남색(네이비)"

}

}

성공 응답 (200)

{

"success": true,

"data": {

"fabricId": 1,

"status": "POSTED"

}

}

처리 규칙

판매 형태(sale_type)는 바꿀 수 없어요. 다르게 보내면 VALIDATION_ERROR 예요.

detail 은 보낸 항목만 바뀌어요.

지금 값에 보낸 값을 덮어쓴 "바뀐 뒤의 모습"으로 등록 검사 규칙을 다시 검사해요.

반려(REJECTED)된 원단을 고치면 다시 게시 대기(PENDING)가 되고 반려 사유가 지워져요. 게시 중(POSTED)이면 상태가 그대로이고 바로 반영돼요.

판매 완료(SOLD_OUT)는 수정할 수 없어요.

롤의 남은 길이를 이미 수락된 예약의 확보 길이보다 작게 줄일 수 없어요.

가격(price)을 바꿔도 이미 요청된 예약의 예상 금액(estimated_price)은 바뀌지 않아요. 바뀐 가격은 새 예약 요청부터 적용돼요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | SCRAP_LENGTH_OUT_OF_RANGE | 자투리인데 length_cm 가 30~90cm 가 아니거나 없어요. |
| 400 | ROLL_LENGTH_REQUIRED | 롤인데 remaining_length_cm 가 없거나 90cm 미만이에요. |
| 400 | DEFECT_NOTE_REQUIRED | has_defect 가 true 인데 defect_note 가 없어요. |
| 409 | INSUFFICIENT_LENGTH | 구매 가능 길이(남은 길이 - 확보 길이)가 부족해요. 수정 시에는 확보한 길이보다 줄일 수 없어요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 13. 원단 삭제

| 항목 | 내용 |
| --- | --- |
| Method / URL | DELETE /api/v1/fabrics/{fabricId} |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 자기 원단을 삭제해요. 실제로 지우지 않고 삭제 표시(deleted_at)만 해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

성공 응답 (200)

{

"success": true,

"data": null

}

처리 규칙

요청됨·수락됨 예약이 있으면 삭제할 수 없어요.

삭제하면 목록과 상세에서 사라져요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | FABRIC_HAS_ACTIVE_RESERVATION | 요청됨·수락됨 예약이 있는 원단이에요. |

### 14. 내 원단 목록 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/sellers/me/fabrics |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 자기 매장의 원단을 상태와 관계없이 봐요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 상태 / 값: PENDING, POSTED, REJECTED, SOLD_OUT |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"fabricId": 3,

"title": "반려될 원단",

"sale_type": "SCRAP",

"price": 3000,

"material": "COTTON",

"thickness": "NORMAL",

"color_family": "NAVY",

"width_cm": 150,

"length_cm": 65,

"available_length_cm": null,

"is_reserved": false,

"has_defect": true,

"thumbnail_url": null,

"store_name": "양주원단상회",

"status": "REJECTED",

"reject_reason": "하자 사진이 필요해요",

"active_reservation_count": 0

},

...

],

"page": 0,

"size": 20,

"totalElements": 3,

"totalPages": 1

}

}

처리 규칙

status 로 PENDING, POSTED, REJECTED, SOLD_OUT 을 골라 볼 수 있어요.

반려된 원단은 reject_reason 으로 사유를 확인해요.

active_reservation_count 는 요청됨·수락됨 예약의 수예요.

삭제한 원단은 나오지 않아요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 15. 원단 사진 업로드

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/fabrics/{fabricId}/images |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 원단 사진을 1장 올려요. 파일은 객체 저장소에 올라가고, 원본과 썸네일 주소가 돌아와요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

Form 항목 (multipart/form-data)

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| file | 파일 | 필수 | 이미지 파일 (jpg, png, webp, 5MB 이하) |
| image_type | 문자열 | 선택 | 사진 종류 (FULL, ZOOM, DEFECT) / 값: FULL, ZOOM, DEFECT |

요청 예시

multipart/form-data (file 필드: 이미지 파일)

성공 응답 (201)

{

"success": true,

"data": {

"imageId": 1,

"image_url": "https://api.example.com/uploads/fabrics/1/bb282f0f-5a33-4177-8179-472c97919a95.png",

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"sort_order": 0

}

}

처리 규칙

multipart/form-data 로 보내요. 파일 필드 이름은 file 이고, image_type(FULL, ZOOM, DEFECT)은 선택이에요.

원단 한 개에 사진은 최대 3장이에요. 4장째는 IMAGE_LIMIT_EXCEEDED 예요.

5MB 이하의 jpg, png, webp 만 올릴 수 있어요. 파일 확장자가 아니라 파일 내용을 확인하고, 이미지가 아니면 IMAGE_TOO_LARGE 예요.

sort_order 는 올린 순서(0부터)이고 0번이 대표 사진이에요. 썸네일은 가로 400px 의 webp 예요.

사진이 한 장도 없으면 운영팀이 승인할 수 없어요(IMAGE_REQUIRED).

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | IMAGE_LIMIT_EXCEEDED | 이미 사진이 3장이에요. |
| 400 | IMAGE_TOO_LARGE | 5MB 를 넘거나 jpg, png, webp 가 아니에요. |

### 16. 원단 사진 삭제

| 항목 | 내용 |
| --- | --- |
| Method / URL | DELETE /api/v1/fabrics/{fabricId}/images/{imageId} |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 올린 사진을 지워요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |
| imageId | 정수 | 필수 | 사진 번호 |

성공 응답 (200)

{

"success": true,

"data": null

}

처리 규칙

지우면 남은 사진의 sort_order 를 0부터 다시 매겨요.

저장소의 파일도 함께 지워요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.4 AI 등록

### 17. AI 등록 시작

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/ai-sessions |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 AI 보조 등록을 시작해요. 세션을 만들고 첫 질문을 돌려줘요. |

요청

요청 항목이 없어요. (로그인 토큰만 필요해요)

성공 응답 (201)

{

"success": true,

"data": {

"sessionId": "cfc6563a1cb1c3205682e3fb",

"session_status": "IN_PROGRESS",

"next_question": {

"field": "sale_type",

"text": "자투리 1장인가요, 롤 원단인가요?",

"options": [

"SCRAP",

...

]

},

"ai_draft": {},

"unconfirmed_fields": [],

"is_complete": false

}

}

처리 규칙

세션은 MongoDB 에 저장해요.

매장이 없는 판매자는 STORE_REQUIRED 예요.

승인된 판매자(seller_approval_status 가 APPROVED)만 시작할 수 있어요. 아니면 SELLER_NOT_APPROVED 예요. 승인을 먼저 확인하고, 그다음 매장을 확인해요.

질문 순서는 서버가 정해요: 판매 형태 → 이름 → 가로·세로(롤은 폭·남은 길이) → 소재 → 두께 → 색상 → 하자 → 가격.

next_question 은 세션에 저장하지 않아요. 서버가 질문 순서와 세션의 sale_type, ai_draft, unconfirmed_fields 를 보고 매번 계산해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 403 | SELLER_NOT_APPROVED | 판매자 승인 전이거나 승인이 거절됐어요. |
| 403 | STORE_REQUIRED | 판매자가 매장을 아직 등록하지 않았어요. |

### 18. AI 등록 세션 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/ai-sessions/{sessionId} |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 진행 중인 세션을 다시 불러와서 이어서 해요. 대화 기록(messages)도 함께 줘요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sessionId | 문자열 | 필수 | AI 등록 세션 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"sessionId": "cfc6563a1cb1c3205682e3fb",

"session_status": "IN_PROGRESS",

"next_question": null,

"ai_draft": {

"sale_type": "SCRAP",

"material": "COTTON",

"color_family": "NAVY",

"title": "네이비 면 20수",

"width_cm": 50,

"length_cm": 70,

"has_defect": false,

"price": 3000

},

"unconfirmed_fields": [

"thickness"

],

"is_complete": true,

"messages": [

{

"role": "assistant",

"content": "자투리 1장인가요, 롤 원단인가요?",

"created_at": "2026-10-10T17:31:31+09:00"

},

...

],

"fabric_id": null

}

}

처리 규칙

본인의 세션만 볼 수 있어요.

fabric_id 는 확정된 뒤에 만들어진 원단 번호예요.

next_question 은 저장된 값이 아니라 지금 세션 상태로 계산한 다음 질문이에요. 확정·중단된 세션이면 null 이에요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 19. AI 등록 답변 보내기

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/ai-sessions/{sessionId}/answers |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 질문에 대한 답을 보내고, 정리된 초안(ai_draft)과 다음 질문을 받아요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sessionId | 문자열 | 필수 | AI 등록 세션 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| answer | 문자열 | 선택 | 답변 또는 판매자가 말하듯 쓴 답 / 최소 1자, 최대 1000자 |
| selected | 문자열 | 선택 | 선택 버튼으로 고른 값 / 최소 1자, 최대 50자 |
| finish | true/false | 선택 | true 이면 더 묻지 않고 마무리 |

요청 예시

{

"selected": "SCRAP"

}

성공 응답 (200)

{

"success": true,

"data": {

"sessionId": "cfc6563a1cb1c3205682e3fb",

"session_status": "IN_PROGRESS",

"next_question": {

"field": "title",

"text": "원단 이름(제목)을 알려 주세요. 예: 네이비 면 20수"

},

"ai_draft": {

"sale_type": "SCRAP"

},

"unconfirmed_fields": [],

"is_complete": false

}

}

처리 규칙

말하듯 쓴 답은 answer 로, 선택 버튼을 누른 값은 selected 로 보내요. 둘 다 없고 finish 도 아니면 VALIDATION_ERROR 예요.

selected 는 AI 를 부르지 않고 바로 받아요. 선택 목록에 없는 값이면 VALIDATION_ERROR 예요.

"모름"이라고 답한 항목은 비워 두고(소재는 UNKNOWN) unconfirmed_fields 에 넣어요. 판매자가 확인·수정 화면에서 채워요.

AI 가 선택 목록 밖의 값을 주면 소재는 UNKNOWN, 그 밖의 항목은 빈 값으로 두고 unconfirmed_fields 에 넣어요.

마 단위 답변은 cm로 바꿔 저장해요 (1마 = 90cm, 예: 3마 → 270).

자투리 길이가 90cm 를 넘으면 "롤로 등록할까요?", 30cm 미만이면 "30cm 이상만 등록할 수 있어요"를 next_question 으로 줘요.

finish 가 true 이면 더 묻지 않고 지금까지의 초안을 보여줘요(is_complete 가 true).

AI 응답 실패·시간 초과·형식 오류는 서버가 1회 다시 시도해요. 그래도 안 되면 503 AI_UNAVAILABLE 이고, 그때까지의 초안은 남아요.

이미 끝난(확정·중단) 세션이면 AI_SESSION_CLOSED 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | AI_SESSION_CLOSED | 이미 확정되거나 중단된 세션이에요. |
| 503 | AI_UNAVAILABLE | AI 응답이 실패했어요(1회 다시 시도한 뒤에도). 직접 입력으로 계속하게 안내해요. |

### 20. AI 등록 확정

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/ai-sessions/{sessionId}/confirm |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 확인·수정한 최종본으로 원단을 만들어요. 요청 본문은 POST /fabrics 와 같아요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sessionId | 문자열 | 필수 | AI 등록 세션 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sale_type | 문자열 | 필수 | 판매 형태 (SCRAP: 자투리, ROLL: 롤) / 값: SCRAP, ROLL |
| title | 문자열 | 필수 | 제목 / 최소 1자, 최대 100자 |
| price | 정수 | 필수 | 가격(원). 자투리는 장당, 롤은 90cm당 / 최소 1 |
| remaining_length_cm | 정수 또는 null | 선택 | 롤의 남은 길이(cm). 롤만, 90 이상 |
| detail | 객체 | 필수 | 원단상세 |
| detail.material | 문자열 | 선택 | 소재 / 값: COTTON, LINEN, POLYESTER, NYLON, RAYON, WOOL, BLEND, ETC, UNKNOWN. 보내지 않으면 UNKNOWN |
| detail.thickness | 문자열 | 필수 | 두께 / 값: THIN, NORMAL, THICK |
| detail.color_family | 문자열 | 필수 | 색상 계열 / 값: WHITE, BLACK, GRAY, BEIGE, BROWN, RED, PINK, YELLOW, GREEN, BLUE, NAVY, PURPLE, MIXED |
| detail.color_detail | 문자열 또는 null | 선택 | 색상 설명 / 최대 100자 |
| detail.width_cm | 정수 | 필수 | 가로(폭) cm / 최소 1, 최대 1000 |
| detail.length_cm | 정수 또는 null | 선택 | 세로 길이 cm. 자투리만, 30~90 |
| detail.has_defect | true/false | 선택 | 하자 여부 (기본 false) |
| detail.defect_note | 문자열 또는 null | 선택 | 하자 위치와 내용. has_defect 가 true 이면 필수 / 최대 255자 |
| detail.blend_ratio | 문자열 또는 null | 선택 | 혼방 비율 / 최대 100자 |
| detail.weave | 문자열 또는 null | 선택 | 직조 / 최대 50자 |
| detail.grain_direction | 문자열 또는 null | 선택 | 결 방향 / 최대 50자 |
| detail.description | 문자열 또는 null | 선택 | 설명 / 최대 5000자 |

요청 예시

{

"sale_type": "SCRAP",

"title": "네이비 면 20수",

"price": 3000,

"remaining_length_cm": null,

"detail": {

"material": "COTTON",

"thickness": "THIN",

"color_family": "NAVY",

"width_cm": 50,

"length_cm": 70,

"has_defect": false

}

}

성공 응답 (201)

{

"success": true,

"data": {

"fabricId": 5,

"status": "PENDING"

}

}

처리 규칙

자투리(SCRAP): detail.length_cm 은 30~90cm 이고, remaining_length_cm 은 보내지 않아요.

롤(ROLL): remaining_length_cm 은 90cm 이상이고, detail.length_cm 은 보내지 않아요.

has_defect 가 true 이면 defect_note(하자 위치와 내용)가 꼭 필요해요.

material, thickness, color_family 는 코드값 목록 안에서만 보낼 수 있어요. 소재를 모르면 UNKNOWN 을 보내거나 비워 두면 UNKNOWN 으로 저장해요.

세션에는 최종본(final_data)과 fabric_id 가 남고, 초안(ai_draft)은 그대로 남아요. 초안과 최종본을 비교할 수 있어요.

두 번 눌러도 원단은 하나만 만들어져요. 이미 끝난 세션이면 AI_SESSION_CLOSED 예요.

검사에 걸려 실패하면 세션은 계속 진행 중이에요.

확정된 원단도 게시 대기(PENDING)로 시작하고 운영팀 승인이 필요해요.

승인된 판매자(seller_approval_status 가 APPROVED)만 확정할 수 있어요. 아니면 SELLER_NOT_APPROVED 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 403 | SELLER_NOT_APPROVED | 판매자 승인 전이거나 승인이 거절됐어요. |
| 403 | STORE_REQUIRED | 판매자가 매장을 아직 등록하지 않았어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 400 | SCRAP_LENGTH_OUT_OF_RANGE | 자투리인데 length_cm 가 30~90cm 가 아니거나 없어요. |
| 400 | ROLL_LENGTH_REQUIRED | 롤인데 remaining_length_cm 가 없거나 90cm 미만이에요. |
| 400 | DEFECT_NOTE_REQUIRED | has_defect 가 true 인데 defect_note 가 없어요. |
| 409 | AI_SESSION_CLOSED | 이미 확정되거나 중단된 세션이에요. |

### 21. AI 등록 중단

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/ai-sessions/{sessionId}/abort |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | AI 등록을 그만두고 직접 입력으로 바꿔요. 지금까지의 초안을 돌려줘요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| sessionId | 문자열 | 필수 | AI 등록 세션 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"sessionId": "cd0d3354cfd056946fa35c47",

"session_status": "ABORTED",

"ai_draft": {

"sale_type": "ROLL"

},

"unconfirmed_fields": []

}

}

처리 규칙

프론트엔드가 돌려받은 ai_draft 를 직접 입력 화면에 채워 넣어요.

중단한 뒤에는 답변·확정을 할 수 없어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | AI_SESSION_CLOSED | 이미 확정되거나 중단된 세션이에요. |

## 5.5 도안

### 22. 도안 목록 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/patterns |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 사용 중인 도안 목록을 누구나 볼 수 있어요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| category | 문자열 | 선택 | 분류 / 최대 50자 |
| keyword | 문자열 | 선택 | 검색어 / 최대 100자 |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"patternId": 1,

"pattern_name": "에코백",

"aliases": "장바구니, 토트백",

"category": "가방",

"image_url": null,

"allowed_materials": [

"COTTON",

...

],

"allowed_thickness": [

"NORMAL",

...

]

},

...

],

"page": 0,

"size": 20,

"totalElements": 5,

"totalPages": 1

}

}

처리 규칙

keyword 는 도안 이름과 별칭(aliases)에서 찾아요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 23. 도안 상세 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/patterns/{patternId} |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 도안의 부품(치수)과 허용 소재·두께를 봐요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| patternId | 정수 | 필수 | 도안 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"patternId": 1,

"pattern_name": "에코백",

"aliases": "장바구니, 토트백",

"category": "가방",

"description": "가장 기본적인 천 가방",

"image_url": null,

"allowed_materials": [

"COTTON",

...

],

"allowed_thickness": [

"NORMAL",

...

],

"reviewed_by": "시연용 예시",

"parts": [

{

"part_name": "몸판",

"width_cm": 40,

"height_cm": 45,

"quantity": 2

},

...

]

}

}

처리 규칙

사용 중이 아닌 도안은 404 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.6 추천

### 24. 원단 기준 도안 추천

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/fabrics/{fabricId}/recommendations |
| 권한 | 공개 |
| 구분 | 필수 |
| 설명 | 이 원단으로 만들 수 있는 도안을 추천해요. AI 없이 서버가 계산해요. 로그인하지 않아도 볼 수 있어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"available": true,

"items": [

{

"patternId": 1,

"pattern_name": "에코백",

"image_url": null,

"judgement": "SUITABLE",

"reasons": [

{

"criterion": "WIDTH",

"required": 96,

"actual": 150,

"met": true,

"text": "필요 가로 96cm 이상 → 폭 150cm (충족)"

},

{

"criterion": "LENGTH",

"required": 60,

"actual": 65,

"met": true,

"text": "필요 세로 60cm 이상 → 길이 65cm (충족)"

},

...

],

"required_length_cm": null,

"purchase_length_cm": null,

"yards": null,

"estimated_price": null

},

...

],

"notices": [

"실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요"

],

"message": null

}

}

처리 규칙

게시 중이 아니거나, 자투리가 예약 중이거나, 롤의 구매 가능 길이가 90cm 미만이면 available 이 false 이고 items 가 비어 있어요.

비교 대상은 사용 중(is_active)인 도안 전체예요. 판정은 모두 코드로 계산하고 AI 를 쓰지 않아요.

자투리 크기: 모든 부품을 원단 폭 방향으로 한 줄로 나란히 놓는다고 보고 계산해요. 원단 폭 ≥ 부품 가로의 합(장수 포함), 원단 길이 ≥ 부품 세로의 최댓값이어야 해요.

롤 크기: 원단 폭 ≥ 부품 가로의 최댓값이고, 구매 가능 길이(남은 길이 − 확보 길이) ≥ 구매 길이여야 해요. 필요 길이 = 부품 세로 × 장수의 합, 구매 길이 = 필요 길이를 90cm 단위로 올림, 예상 금액 = 90cm당 가격 × 마 수예요.

부품을 돌리거나(회전) 여러 줄로 놓는 계산은 하지 않아요. 부품 가로는 원단 폭 방향, 부품 세로는 원단 길이(식서) 방향과 비교해요.

소재: 허용 소재에 있으면 적합(SUITABLE), 원단이 UNKNOWN 이면 크기·두께가 맞는 도안을 확인 필요(NEEDS_CHECK), 그 밖은 부적합이에요. 소재가 UNKNOWN 이면 notices 에 "소재를 판매자에게 확인해 보세요"가 들어가요. 두께: 허용 두께에 없으면 부적합이에요. 부적합 도안은 items 에 넣지 않아요.

예시: 에코백(앞판 40×45 1장, 뒤판 40×45 1장, 끈 8×60 2장)은 자투리 기준 가로 96(40+40+8+8)·세로 60 이상, 롤 기준 폭 40 이상·필요 길이 210 → 구매 길이 270(3마)이에요.

적합(SUITABLE) 최대 5개, 확인 필요(NEEDS_CHECK) 최대 3개예요. 자투리는 필요 면적이 큰 도안부터, 롤은 필요 마 수가 적은 도안부터 정렬해요.

자투리의 필요 면적은 부품마다 가로×세로×장수를 더한 값이에요.

reasons 는 판단 근거(WIDTH, LENGTH, MATERIAL, THICKNESS)이고 met 이 null 이면 확인이 필요하다는 뜻이에요.

reasons 의 required 값: 자투리 WIDTH = 부품 가로의 합(장수 포함), LENGTH = 부품 세로의 최댓값. 롤 WIDTH = 부품 가로의 최댓값, LENGTH = 구매 길이(90cm 단위 올림)이고 actual 은 구매 가능 길이예요.

notices 에는 항상 "실물 확인 권장" 안내가 들어가요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.7 예약

### 25. 예약 요청

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/reservations |
| 권한 | BUYER |
| 구분 | 필수 |
| 설명 | 구매자가 원단을 예약해요(요청 단계). 요청만으로는 재고를 확보하지 않고, 판매자가 수락해야 확보돼요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabric_id | 정수 | 필수 | 원단 번호 |
| pickup_at | 날짜(ISO 8601) | 필수 | 희망 픽업 일시 (ISO 8601, 지금 이후) |
| memo | 문자열 또는 null | 선택 | 요청 메모 / 최대 500자 |
| requested_length_cm | 정수 또는 null | 선택 | 구매할 길이(cm). 롤만, 90의 배수 |
| pattern_id | 정수 또는 null | 선택 | 도안 번호 |

요청 예시

{

"fabric_id": 1,

"pattern_id": 1,

"pickup_at": "2026-10-12T08:31:31Z",

"memo": "오후 2시쯤 갈게요"

}

성공 응답 (201)

{

"success": true,

"data": {

"reservationId": 1,

"status": "REQUESTED",

"estimated_price": null

}

}

처리 규칙

구매자(BUYER)만 요청할 수 있어요. 판매자·운영팀은 FORBIDDEN 이에요.

게시 중(POSTED)이 아닌 원단은 FABRIC_NOT_AVAILABLE 이에요.

pickup_at 은 지금 이후여야 해요.

자투리는 requested_length_cm 를 보내지 않아요. 이미 수락된 예약이 있으면 SCRAP_ALREADY_RESERVED 예요.

롤은 requested_length_cm 가 필수이고 90의 배수(1마 단위)여야 해요. 구매 가능 길이(남은 길이 - 확보 길이)보다 많으면 INSUFFICIENT_LENGTH 예요.

롤의 estimated_price = 90cm당 가격 x 마 수이고, 요청 시점의 가격으로 고정돼요. 판매자가 나중에 가격을 바꿔도 이 값은 바뀌지 않아요. 자투리는 null 이에요.

같은 구매자가 같은 원단에 요청됨·수락됨 예약을 두 개 가질 수 없어요(DUPLICATE_RESERVATION). 동시에 눌러도 하나만 만들어져요.

pattern_id 는 선택이고, 사용 중인 도안이어야 해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | FABRIC_NOT_AVAILABLE | 게시 중이 아니거나 판매 완료된 원단이에요. |
| 409 | DUPLICATE_RESERVATION | 같은 원단에 이미 요청됨·수락됨 예약이 있어요. |
| 409 | SCRAP_ALREADY_RESERVED | 자투리에 이미 수락된 예약이 있어요. |
| 400 | LENGTH_NOT_MULTIPLE_OF_90 | 롤의 requested_length_cm 가 90의 배수가 아니에요. |
| 409 | INSUFFICIENT_LENGTH | 구매 가능 길이(남은 길이 - 확보 길이)가 부족해요. 수정 시에는 확보한 길이보다 줄일 수 없어요. |

### 26. 내 예약 목록 (구매자)

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/reservations/me |
| 권한 | BUYER |
| 구분 | 필수 |
| 설명 | 구매자가 자기 예약을 봐요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 상태 / 값: REQUESTED, ACCEPTED, REJECTED, CANCELED, PICKED_UP |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"reservationId": 1,

"status": "REQUESTED",

"pickup_at": "2026-10-12T17:31:31+09:00",

"requested_length_cm": null,

"estimated_price": null,

"reject_reason": null,

"fabricId": 1,

"title": "네이비 면 20수",

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"store_name": "양주원단상회"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

status 로 걸러 볼 수 있어요.

수락된(ACCEPTED) 예약에는 store_address 와 pickup_guide 가 함께 와요.

거절된 예약은 reject_reason 으로 사유를 봐요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 27. 받은 예약 목록 (판매자)

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/sellers/me/reservations |
| 권한 | SELLER |
| 구분 | 필수 |
| 설명 | 판매자가 자기 원단에 들어온 예약을 봐요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 상태 / 값: REQUESTED, ACCEPTED, REJECTED, CANCELED, PICKED_UP |
| fabric_id | 정수 | 선택 | 원단 번호 |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"reservationId": 1,

"status": "REQUESTED",

"pickup_at": "2026-10-12T17:31:31+09:00",

"memo": "오후 2시쯤 갈게요",

"requested_length_cm": null,

"estimated_price": null,

"fabricId": 1,

"title": "네이비 면 20수",

"buyer_nickname": "재봉러"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

status, fabric_id 로 걸러 볼 수 있어요.

구매자의 전화번호는 주지 않아요. 닉네임(buyer_nickname)만 보여줘요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 28. 예약 상세 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/reservations/{reservationId} |
| 권한 | 당사자 |
| 구분 | 필수 |
| 설명 | 예약 정보와 원단 요약, 매장 픽업 정보, 선택한 도안 이름을 봐요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reservationId | 정수 | 필수 | 예약 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"reservationId": 1,

"status": "REQUESTED",

"pickup_at": "2026-10-12T17:31:31+09:00",

"memo": "오후 2시쯤 갈게요",

"requested_length_cm": null,

"estimated_price": null,

"reject_reason": null,

"canceled_by": null,

"accepted_at": null,

"picked_up_at": null,

"canceled_at": null,

"created_at": "2026-10-10T17:31:31+09:00",

"buyer_nickname": "재봉러",

"pattern_name": "에코백",

"fabric": {

"fabricId": 1,

"title": "네이비 면 20수",

"sale_type": "SCRAP",

"status": "POSTED",

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp"

},

"store": {

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일, 공휴일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

}

}

처리 규칙

예약한 구매자와 그 원단의 판매자만 볼 수 있어요. 다른 사람은 FORBIDDEN 이에요.

canceled_by 는 취소한 쪽(BUYER, SELLER), canceled_at 은 취소 시각이에요. reject_reason 은 거절(REJECTED)일 때만 값이 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 29. 예약 수락

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/reservations/{reservationId}/accept |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 예약을 수락해요. 이때 재고를 확보해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reservationId | 정수 | 필수 | 예약 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| pickup_at | 날짜(ISO 8601) | 선택 | 희망 픽업 일시 (ISO 8601, 지금 이후) |

요청 예시

{}

성공 응답 (200)

{

"success": true,

"data": {

"reservationId": 1,

"status": "ACCEPTED"

}

}

처리 규칙

요청됨(REQUESTED)만 수락할 수 있고, 원단이 게시 중이어야 해요.

수락할 때 재고를 다시 확인해요. 요청한 뒤 다른 예약이 먼저 수락됐다면 자투리는 SCRAP_ALREADY_RESERVED, 롤은 INSUFFICIENT_LENGTH 예요.

롤은 reserved_length_cm 가 요청 길이만큼 늘어요. 자투리는 수락된 예약이 있는 동안 "예약 중"이에요.

pickup_at 을 보내면 픽업 일시를 조정해요(지금 이후).

같은 원단에 동시에 수락해도 한 건만 성공해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |
| 409 | SCRAP_ALREADY_RESERVED | 자투리에 이미 수락된 예약이 있어요. |
| 409 | INSUFFICIENT_LENGTH | 구매 가능 길이(남은 길이 - 확보 길이)가 부족해요. 수정 시에는 확보한 길이보다 줄일 수 없어요. |

### 30. 예약 거절

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/reservations/{reservationId}/reject |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 요청된 예약을 거절해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reservationId | 정수 | 필수 | 예약 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reason | 문자열 | 필수 | 사유 / 최소 1자, 최대 255자 |

요청 예시

{

"reason": "다른 분과 약속이 잡혔어요"

}

성공 응답 (200)

{

"success": true,

"data": {

"reservationId": 2,

"status": "REJECTED"

}

}

처리 규칙

요청됨(REQUESTED)만 거절할 수 있어요.

사유(reason)는 필수예요.

재고는 변하지 않아요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 31. 예약 취소

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/reservations/{reservationId}/cancel |
| 권한 | 당사자 |
| 구분 | 필수 |
| 설명 | 구매자 또는 판매자가 예약을 취소해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reservationId | 정수 | 필수 | 예약 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"reservationId": 1,

"status": "CANCELED"

}

}

처리 규칙

구매자는 요청됨·수락됨 예약을 취소할 수 있어요. 판매자는 수락됨 예약만 취소할 수 있어요(요청됨은 거절을 써요).

수락된 예약을 취소하면 확보했던 재고가 풀려요.

요청 본문은 없어요. 취소 사유는 받지 않아요.

canceled_by 에 취소한 쪽(BUYER, SELLER), canceled_at 에 취소 시각이 기록돼요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 32. 수령 확인

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/reservations/{reservationId}/pickup |
| 권한 | SELLER(본인) |
| 구분 | 필수 |
| 설명 | 판매자가 구매자가 원단을 가져간 것을 확인해요. 이때 재고를 차감해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reservationId | 정수 | 필수 | 예약 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"reservationId": 3,

"status": "PICKED_UP"

}

}

처리 규칙

수락됨(ACCEPTED)만 수령 확인을 할 수 있어요.

자투리는 원단이 판매 완료(SOLD_OUT)가 돼요.

롤은 남은 길이와 확보 길이가 요청 길이만큼 줄어요. 남은 길이가 90cm 미만이면 판매 완료가 돼요.

판매 완료가 되면 그 원단에 남은 요청됨 예약은 "판매 완료" 사유로 자동 거절돼요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

## 5.8 운영

### 33. 게시 대기 원단 목록 (운영팀)

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/admin/fabrics |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 심사할 원단을 봐요. 기본은 게시 대기(PENDING)이고 오래 기다린 순이에요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 상태 / 값: PENDING, POSTED, REJECTED, SOLD_OUT, 기본값 PENDING |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"fabricId": 1,

"title": "네이비 면 20수",

"sale_type": "SCRAP",

"price": 3000,

"remaining_length_cm": null,

"status": "PENDING",

"store_name": "양주원단상회",

"detail": {

"material": "COTTON",

"thickness": "NORMAL",

"color_family": "NAVY",

"color_detail": "짙은 남색",

"width_cm": 150,

"length_cm": 65,

"has_defect": true,

"defect_note": "오른쪽 아래 얼룩 3cm",

"blend_ratio": null,

"weave": null,

"grain_direction": null,

"description": "앞치마용으로 쓰던 원단이에요"

},

"images": [

{

"imageId": 1,

"image_url": "https://api.example.com/uploads/fabrics/1/bb282f0f-5a33-4177-8179-472c97919a95.png",

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"image_type": "FULL",

"sort_order": 0

}

],

"created_at": "2026-10-10T17:31:31+09:00"

},

...

],

"page": 0,

"size": 20,

"totalElements": 2,

"totalPages": 1

}

}

처리 규칙

각 원단의 상세, 사진, 매장 이름을 함께 줘요.

status 로 다른 상태도 볼 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 34. 게시 승인

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/admin/fabrics/{fabricId}/approve |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 원단을 승인해서 게시 중(POSTED)으로 바꿔요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"fabricId": 1,

"status": "POSTED"

}

}

처리 규칙

게시 대기(PENDING)만 승인할 수 있어요.

사진이 1장 이상 있어야 해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |
| 400 | IMAGE_REQUIRED | 사진이 한 장도 없는 원단은 승인할 수 없어요. |

### 35. 게시 반려

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/admin/fabrics/{fabricId}/reject |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 원단을 반려해요(REJECTED). |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| reason | 문자열 | 필수 | 사유 / 최소 1자, 최대 255자 |

요청 예시

{

"reason": "하자 사진이 필요해요"

}

성공 응답 (200)

{

"success": true,

"data": {

"fabricId": 3,

"status": "REJECTED"

}

}

처리 규칙

게시 대기(PENDING)만 반려할 수 있어요.

사유(reason)는 필수예요. 판매자가 내 원단 목록에서 사유를 보고 고쳐서 다시 심사를 받아요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 36. 판매자 목록 (운영팀)

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/admin/sellers |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 승인할 판매자와 매장 정보를 봐요. 기본은 승인 대기(PENDING)이고 오래 기다린 순이에요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 승인 상태 / 값: PENDING, APPROVED, REJECTED, 기본값 PENDING |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"userId": 2,

"email": "seller@example.com",

"nickname": "양주원단",

"phone_number": "010-1234-5678",

"seller_approval_status": "PENDING",

"created_at": "2026-10-10T16:31:31+09:00",

"store": {

"storeId": 1,

"store_name": "양주원단상회",

"store_address": "경기도 양주시 어딘가로 12",

"store_phone": "031-123-4567",

"closed_days": "매주 일요일, 공휴일",

"pickup_guide": "평일 10~18시, 1층 카운터에서 말씀해 주세요"

}

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

status 로 다른 승인 상태도 볼 수 있어요.

각 판매자의 회원 정보와 매장 정보를 함께 줘요. 매장을 아직 등록하지 않았으면 store 가 null 이에요.

운영팀은 회원 정보와 매장 정보를 보고 승인 여부를 정해요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 37. 판매자 승인

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/admin/sellers/{userId}/approve |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 판매자를 승인해요. 승인된 판매자만 원단을 등록할 수 있어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| userId | 정수 | 필수 | 판매자 회원 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"userId": 2,

"seller_approval_status": "APPROVED"

}

}

처리 규칙

승인 대기(PENDING)나 거절(REJECTED)된 판매자를 승인할 수 있어요. 이미 승인된 판매자면 INVALID_STATUS 예요.

요청 본문은 없어요.

판매자가 아니거나 탈퇴한 회원이면 NOT_FOUND 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 38. 판매자 거절

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/admin/sellers/{userId}/reject |
| 권한 | ADMIN |
| 구분 | 필수 |
| 설명 | 운영팀이 판매자 신청을 거절해요. 거절된 판매자는 원단을 등록할 수 없어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| userId | 정수 | 필수 | 판매자 회원 번호 |

성공 응답 (200)

{

"success": true,

"data": {

"userId": 2,

"seller_approval_status": "REJECTED"

}

}

처리 규칙

승인 대기(PENDING)인 판매자만 거절할 수 있어요.

요청 본문은 없어요. 거절 사유는 받지 않아요.

거절된 판매자는 다시 신청할 수 없어요. 운영팀이 37번으로 승인할 수 있어요.

판매자가 아니거나 탈퇴한 회원이면 NOT_FOUND 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

## 5.9 관심

### 39. 관심저장 추가

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/favorites |
| 권한 | 로그인 |
| 구분 | 선택 |
| 설명 | 원단 또는 도안을 관심 목록에 저장해요. |

요청

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| target_type | 문자열 | 필수 | 대상 종류 (FABRIC 또는 PATTERN) / 값: FABRIC, PATTERN |
| fabric_id | 정수 | 선택 | 원단 번호 |
| pattern_id | 정수 | 선택 | 도안 번호 |

요청 예시

{

"target_type": "FABRIC",

"fabric_id": 1

}

성공 응답 (201)

{

"success": true,

"data": {

"favoriteId": 1

}

}

처리 규칙

target_type 이 FABRIC 이면 fabric_id 만, PATTERN 이면 pattern_id 만 보내요.

게시 중인 원단, 사용 중인 도안만 저장할 수 있어요.

같은 대상을 두 번 저장하면 FAVORITE_DUPLICATED 예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 409 | FAVORITE_DUPLICATED | 이미 관심 목록에 있어요. |

### 40. 내 관심 목록

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/favorites/me |
| 권한 | 로그인 |
| 구분 | 선택 |
| 설명 | 저장한 원단과 도안을 봐요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| target_type | 문자열 | 선택 | 대상 종류 (FABRIC 또는 PATTERN) / 값: FABRIC, PATTERN |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"favoriteId": 1,

"target_type": "FABRIC",

"created_at": "2026-10-10T17:31:31+09:00",

"fabricId": 1,

"title": "네이비 면 20수",

"sale_type": "SCRAP",

"price": 3500,

"thumbnail_url": "https://api.example.com/uploads/fabrics/1/thumbs/bb282f0f-5a33-4177-8179-472c97919a95.webp",

"fabric_status": "POSTED",

"is_deleted": false

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

target_type 으로 원단 또는 도안만 볼 수 있어요.

판매 완료·삭제된 원단도 목록에 남고, fabric_status 와 is_deleted 로 "판매 종료"를 표시할 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 41. 관심저장 삭제

| 항목 | 내용 |
| --- | --- |
| Method / URL | DELETE /api/v1/favorites/{favoriteId} |
| 권한 | 로그인(본인) |
| 구분 | 선택 |
| 설명 | 관심 목록에서 지워요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| favoriteId | 정수 | 필수 | 관심저장 번호 |

성공 응답 (200)

{

"success": true,

"data": null

}

처리 규칙

본인이 저장한 것만 지울 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.10 문의

### 42. 문의 작성

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/fabrics/{fabricId}/inquiries |
| 권한 | BUYER |
| 구분 | 선택 |
| 설명 | 구매자가 원단에 대해 판매자에게 문의해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| content | 문자열 | 필수 | 내용 / 최소 1자, 최대 1000자 |
| is_private | true/false | 선택 | 비공개 여부 (기본 false) / 기본값 false |

요청 예시

{

"content": "세탁하면 많이 줄어드나요?",

"is_private": false

}

성공 응답 (201)

{

"success": true,

"data": {

"inquiryId": 1,

"status": "WAITING"

}

}

처리 규칙

구매자(BUYER)만 쓸 수 있어요.

게시 중인 원단에만 문의할 수 있어요.

is_private 가 true 이면 비공개 문의예요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 43. 원단 문의 목록

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/fabrics/{fabricId}/inquiries |
| 권한 | 공개 |
| 구분 | 선택 |
| 설명 | 원단 상세 화면에 보이는 문의 목록이에요. 로그인하지 않아도 볼 수 있어요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| fabricId | 정수 | 필수 | 원단 번호 |

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"inquiryId": 1,

"fabricId": 1,

"fabric_title": "네이비 면 20수",

"buyer_nickname": "재봉러",

"is_private": false,

"status": "WAITING",

"content": "세탁하면 많이 줄어드나요?",

"answer": null,

"answered_at": null,

"created_at": "2026-10-10T17:31:31+09:00"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

비공개 문의는 작성자, 그 원단의 판매자, 운영팀에게만 내용과 답변을 보여줘요. 다른 사람에게는 content 가 "비공개 문의입니다"이고 answer 는 null 이에요.

삭제한 문의는 나오지 않아요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

### 44. 받은 문의 목록 (판매자)

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/sellers/me/inquiries |
| 권한 | SELLER |
| 구분 | 선택 |
| 설명 | 판매자가 자기 원단에 들어온 문의를 봐요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| status | 문자열 | 선택 | 상태 / 값: WAITING, ANSWERED |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"inquiryId": 1,

"fabricId": 1,

"fabric_title": "네이비 면 20수",

"buyer_nickname": "재봉러",

"is_private": false,

"status": "WAITING",

"content": "세탁하면 줄어드나요?",

"answer": null,

"answered_at": null,

"created_at": "2026-10-10T17:31:31+09:00"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

status 로 답변 대기(WAITING), 답변 완료(ANSWERED)를 걸러 볼 수 있어요.

판매자는 비공개 문의도 볼 수 있어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 45. 문의 답변

| 항목 | 내용 |
| --- | --- |
| Method / URL | POST /api/v1/inquiries/{inquiryId}/answer |
| 권한 | SELLER(본인) |
| 구분 | 선택 |
| 설명 | 판매자가 문의에 답변해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| inquiryId | 정수 | 필수 | 문의 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| answer | 문자열 | 필수 | 답변 또는 판매자가 말하듯 쓴 답 / 최소 1자, 최대 1000자 |

요청 예시

{

"answer": "찬물 단독 세탁을 권해요. 거의 줄지 않았어요."

}

성공 응답 (200)

{

"success": true,

"data": {

"inquiryId": 1,

"status": "ANSWERED"

}

}

처리 규칙

그 원단의 판매자만 답변할 수 있어요.

답변하면 status 가 ANSWERED 가 돼요. 다시 보내면 답변을 고쳐 써요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

### 46. 문의 수정

| 항목 | 내용 |
| --- | --- |
| Method / URL | PATCH /api/v1/inquiries/{inquiryId} |
| 권한 | BUYER(본인) |
| 구분 | 선택 |
| 설명 | 구매자가 자기 문의를 고쳐요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| inquiryId | 정수 | 필수 | 문의 번호 |

Body 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| content | 문자열 | 선택 | 내용 / 최소 1자, 최대 1000자 |
| is_private | true/false | 선택 | 비공개 여부 (기본 false) |

요청 예시

{

"content": "세탁하면 줄어드나요?"

}

성공 응답 (200)

{

"success": true,

"data": {

"inquiryId": 1,

"status": "WAITING"

}

}

처리 규칙

작성자 본인만, 답변 전(WAITING)에만 고칠 수 있어요.

보낸 항목만 바뀌어요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |
| 409 | INVALID_STATUS | 지금 상태에서는 할 수 없는 동작이에요. |

### 47. 문의 삭제

| 항목 | 내용 |
| --- | --- |
| Method / URL | DELETE /api/v1/inquiries/{inquiryId} |
| 권한 | BUYER(본인) |
| 구분 | 선택 |
| 설명 | 구매자가 자기 문의를 지워요. 삭제 표시(deleted_at)만 해요. |

요청

Path 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| inquiryId | 정수 | 필수 | 문의 번호 |

성공 응답 (200)

{

"success": true,

"data": null

}

처리 규칙

작성자 본인만 지울 수 있어요.

삭제하면 목록에서 사라져요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 401 | UNAUTHORIZED | 토큰이 없거나, 잘못됐거나, 만료됐어요. |
| 403 | FORBIDDEN | 역할이 다르거나 내 데이터가 아니에요. |
| 404 | NOT_FOUND | 없거나 볼 수 없는 데이터예요. |

## 5.12 공장

### 48. 공장 목록 조회

| 항목 | 내용 |
| --- | --- |
| Method / URL | GET /api/v1/factories |
| 권한 | 공개 |
| 구분 | 선택 |
| 설명 | 양주시 공장 목록을 누구나 볼 수 있어요. 생산품 문장을 업종 카테고리로 묶어, 한 업종만 골라 볼 수 있어요. |

요청

Query 항목

| 이름 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| category | 문자열 | 선택 | 업종. 값: TEXTILE, APPAREL, LEATHER, FOOD, CHEMICAL, PLASTIC, METAL, WOOD, PAPER, ELECTRIC, CONSTRUCTION, OTHER |
| page | 정수 | 선택 | 페이지 번호 (0부터) / 최소 0, 기본값 0 |
| size | 정수 | 선택 | 한 페이지 개수 (기본 20, 최대 50) / 최소 1, 최대 50, 기본값 20 |

성공 응답 (200)

{

"success": true,

"data": {

"content": [

{

"factoryId": 1,

"factory_name": "대영섬유",

"industry": "직물호부처리",

"category": "TEXTILE",

"address": "경기도 양주시 고암동 385-10",

"latitude": null,

"longitude": null,

"data_source": "양주시청 공장등록 2026-09",

"created_at": "2026-10-12T04:00:00+09:00"

}

],

"page": 0,

"size": 20,

"totalElements": 1,

"totalPages": 1

}

}

처리 규칙

category 를 주면 그 업종만 돌려줘요. 없으면 모든 공장을 돌려줘요.

category 는 생산품(industry) 문장으로 정해요. 따로 저장된 값이 아니에요.

정렬은 등록 순(factory_id 오름차순)이에요.

위도·경도가 없으면 null 이에요.

오류 코드

| HTTP | 코드 | 언제 나오나요 |
| --- | --- | --- |
| 400 | VALIDATION_ERROR | 요청 값의 형식이 올바르지 않아요. error.details 에 항목별 이유가 와요. |

# 6. 상태와 재고 규칙

## 6.1 원단 상태

| 지금 상태 | 동작 | 다음 상태 | 누가 |
| --- | --- | --- | --- |
| (새로 등록) | 원단 등록 / AI 등록 확정 | PENDING | 승인된 판매자 |
| PENDING | 게시 승인 (사진 1장 이상) | POSTED | 운영팀 |
| PENDING | 게시 반려 (사유 필수) | REJECTED | 운영팀 |
| REJECTED | 원단 수정 | PENDING | 판매자 |
| POSTED | 원단 수정 | POSTED (바로 반영) | 판매자 |
| POSTED | 자투리 수령 확인 / 롤 남은 길이가 90cm 미만이 됨 | SOLD_OUT | 판매자 (수령 확인) |
| SOLD_OUT | 원단 수정 | 불가 (INVALID_STATUS) | - |
| 모든 상태 | 원단 삭제 (진행 중 예약이 없을 때) | 삭제 표시 (deleted_at) | 판매자 |

구매자와 로그인하지 않은 사용자에게는 POSTED 원단만 목록·상세에 보여요.

## 6.2 예약 상태와 재고

| 동작 | 누가 | 상태 변화 | 재고 처리 |
| --- | --- | --- | --- |
| 예약 요청 | 구매자 | (새로) REQUESTED | 재고를 확보하지 않아요. 롤은 예상 금액을 요청 시점 가격으로 고정해요. |
| 수락 | 판매자 | REQUESTED → ACCEPTED | 자투리는 "예약 중". 롤은 확보 길이가 요청 길이만큼 늘어요. 수락할 때 재고를 다시 확인해요. |
| 거절 | 판매자 | REQUESTED → REJECTED | 변화 없음. 사유 필수. |
| 취소 | 구매자 | REQUESTED·ACCEPTED → CANCELED | ACCEPTED 였다면 확보한 재고가 풀려요. |
| 취소 | 판매자 | ACCEPTED → CANCELED | 확보한 재고가 풀려요. |
| 수령 확인 | 판매자 | ACCEPTED → PICKED_UP | 자투리는 SOLD_OUT. 롤은 남은 길이와 확보 길이가 줄고, 남은 길이가 90cm 미만이면 SOLD_OUT. |

원단이 SOLD_OUT 이 되면 그 원단에 남은 REQUESTED 예약은 "판매 완료" 사유로 자동 거절돼요.

위 표에 없는 전환은 409 INVALID_STATUS 예요.

## 6.3 롤의 길이 계산

| 이름 | 뜻 |
| --- | --- |
| remaining_length_cm | 롤에 남은 전체 길이 |
| reserved_length_cm | 수락된 예약이 확보한 길이 |
| 구매 가능 길이 (available_length_cm) | remaining_length_cm - reserved_length_cm |
| 예상 금액 (estimated_price) | 90cm당 가격 x (requested_length_cm / 90) |

같은 원단에 동시에 수락해도 구매 가능 길이를 넘지 않아요. 서버가 원단을 잠근 채로 다시 확인해요.

## 6.4 AI 등록 세션

| 지금 상태 | 동작 | 다음 상태 |
| --- | --- | --- |
| IN_PROGRESS | 답변 보내기 | IN_PROGRESS (초안과 다음 질문이 바뀜) |
| IN_PROGRESS | 확정 (원단 생성) | CONFIRMED |
| IN_PROGRESS | 중단 | ABORTED |
| CONFIRMED / ABORTED | 답변·확정·중단 | 불가 (AI_SESSION_CLOSED) |

방치된 세션(IN_PROGRESS, ABORTED)은 마지막 갱신(last_updated_at) 24시간 뒤 자동으로 지워져요. 확정된 세션은 기록으로 남아요. (기간은 임시예요)

## 6.5 판매자 승인 상태

| 지금 상태 | 동작 | 다음 상태 |
| --- | --- | --- |
| (가입) | 판매자로 가입 | PENDING |
| PENDING | 승인 (운영팀) | APPROVED |
| PENDING | 거절 (운영팀) | REJECTED |
| REJECTED | 승인 (운영팀) | APPROVED |
| APPROVED | 승인·거절 | 불가 (INVALID_STATUS) |

APPROVED 인 판매자만 원단을 등록할 수 있어요(직접 입력, AI 등록 시작·확정). 구매자와 운영팀은 승인 상태가 없어요(null).

위 표에 없는 전환은 409 INVALID_STATUS 예요.

# 7. ERD와 API 대응표

ERD의 테이블이 바뀌면 이 표에서 영향을 받는 API를 찾아 고쳐요.

| ERD 테이블 / 컬렉션 | 관련 API |
| --- | --- |
| users | 회원가입, 로그인, 내 정보 조회·수정, 판매자 목록·승인·거절 (그리고 모든 API의 로그인 확인) |
| stores | 매장 등록·조회·수정, 원단 상세의 store, 예약의 픽업 정보 |
| fabrics | 원단 등록·목록·내 원단 목록·상세·수정·삭제, 게시 승인·반려, 예약 수락·수령(재고), 추천, 관심저장, 문의 |
| fabric_details | 원단 등록·수정·상세·목록, 추천 판정, AI 등록 확정 |
| fabric_images | 사진 업로드·삭제, 목록·상세의 사진, 게시 승인(사진 필요) |
| patterns / pattern_parts | 도안 목록·상세, 원단 기준 도안 추천, 예약의 pattern_id, 관심저장 |
| reservations | 예약 요청·수락·거절·취소·수령, 내 예약·받은 예약·예약 상세, 원단 삭제 검사 |
| favorites | 관심저장 추가·목록·삭제 |
| inquiries | 문의 작성·목록·답변·수정·삭제 |
| factories (임시) | 공장 목록 조회 |
| MongoDB ai_registration_sessions | AI 등록 시작·조회·답변·확정·중단 (임시) |

ERD 수정 때 같이 확인할 것

컬럼 이름이 바뀌면: 해당 테이블의 응답 항목 이름과 요청 항목 이름(5장), 코드값 표(2.8)를 함께 고쳐요.

코드값(enum)이 바뀌면: 2.8의 표와 해당 요청 항목의 "값" 목록, 추천 규칙(소재·두께)을 함께 고쳐요.

제약 조건이 바뀌면: 3장의 오류 코드와 5장의 처리 규칙을 함께 고쳐요.

응답에만 있는 계산 값(hasStore, is_reserved, available_length_cm, next_question 등)은 ERD 컬럼이 아니에요. 계산에 쓰는 컬럼이 바뀌면 함께 확인해요.