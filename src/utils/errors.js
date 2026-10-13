// 오류 코드 표. API 명세서 3장 "오류 코드"와 같게 유지한다. (새 코드는 명세서와 함께 추가, 리더 승인)
export const ERRORS = {
  VALIDATION_ERROR: { status: 400, message: '입력값을 확인해 주세요' },
  AGREEMENT_REQUIRED: { status: 400, message: '약관과 개인정보 처리에 동의해 주세요' },
  SCRAP_LENGTH_OUT_OF_RANGE: { status: 400, message: '자투리 길이를 1cm 이상의 정수로 입력해 주세요' },
  ROLL_LENGTH_REQUIRED: { status: 400, message: '롤은 남은 길이를 90cm 이상 입력해 주세요' },
  DEFECT_NOTE_REQUIRED: { status: 400, message: '하자 위치와 내용을 적어 주세요' },
  LENGTH_NOT_MULTIPLE_OF_90: { status: 400, message: '1마(90cm) 단위로 골라 주세요' },
  IMAGE_LIMIT_EXCEEDED: { status: 400, message: '사진은 3장까지 올릴 수 있어요' },
  IMAGE_TOO_LARGE: { status: 400, message: '5MB 이하의 jpg·png·webp만 올릴 수 있어요' },
  IMAGE_REQUIRED: { status: 400, message: '사진이 없는 원단은 게시할 수 없어요' },
  UNAUTHORIZED: { status: 401, message: '다시 로그인해 주세요' },
  LOGIN_FAILED: { status: 401, message: '이메일 또는 비밀번호가 맞지 않아요' },
  FORBIDDEN: { status: 403, message: '권한이 없어요' },
  SELLER_NOT_APPROVED: { status: 403, message: '판매자 승인 후 원단을 등록할 수 있어요' },
  STORE_REQUIRED: { status: 403, message: '매장 정보를 먼저 등록해 주세요' },
  NOT_FOUND: { status: 404, message: '찾을 수 없어요' },
  EMAIL_DUPLICATED: { status: 409, message: '이미 가입한 이메일이에요' },
  STORE_ALREADY_EXISTS: { status: 409, message: '이미 매장을 등록했어요' },
  FABRIC_NOT_AVAILABLE: { status: 409, message: '지금은 구매할 수 없는 원단이에요' },
  SCRAP_ALREADY_RESERVED: { status: 409, message: '이미 예약 중인 원단이에요' },
  INSUFFICIENT_LENGTH: { status: 409, message: '구매 가능한 길이가 부족해요' },
  DUPLICATE_RESERVATION: { status: 409, message: '이미 이 원단을 예약했어요' },
  FABRIC_HAS_ACTIVE_RESERVATION: { status: 409, message: '진행 중인 예약이 있어 삭제할 수 없어요' },
  INVALID_STATUS: { status: 409, message: '지금 상태에서는 할 수 없어요' },
  AI_SESSION_CLOSED: { status: 409, message: '이미 끝난 등록이에요' },
  FAVORITE_DUPLICATED: { status: 409, message: '이미 관심 목록에 있어요' },
  TOO_MANY_REQUESTS: { status: 429, message: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요' },
  INTERNAL_ERROR: { status: 500, message: '잠시 후 다시 시도해 주세요' },
  AI_UNAVAILABLE: { status: 503, message: 'AI 연결이 어려워요. 직접 입력으로 계속해 주세요' },
};

export class AppError extends Error {
  constructor(code, details) {
    const def = ERRORS[code] ?? ERRORS.INTERNAL_ERROR;
    super(def.message);
    this.code = code;
    this.status = def.status;
    this.details = details;
  }
}

// services 에서 "안 된다"를 알릴 때: throw fail('FORBIDDEN')
export const fail = (code, details) => new AppError(code, details);
