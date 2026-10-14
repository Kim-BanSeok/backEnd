import { fail } from '../utils/errors.js';

// API 명세서 9번 "처리 규칙"을 코드로 옮긴 것. 원단 등록·수정·AI 등록 확정이 같은 함수를 쓴다.
// (조회 때 값 범위 오류는 오류 코드로 알려야 해서 zod 가 아니라 여기서 검사한다)
export function assertFabricRules({ sale_type, remaining_length_cm, detail }) {
  if (sale_type === 'SCRAP') {
    // 자투리: 세로 길이는 1cm 이상의 정수. 남은 길이는 보내지 않는다.
    const length = detail.length_cm;
    if (!Number.isInteger(length) || length < 1) throw fail('SCRAP_LENGTH_OUT_OF_RANGE');
    if (remaining_length_cm !== null) {
      throw fail('VALIDATION_ERROR', [
        { field: 'remaining_length_cm', message: '자투리는 남은 길이를 보내지 않아요' },
      ]);
    }
  } else {
    // 롤: 남은 길이 90cm 이상 필수, 세로 길이는 보내지 않는다.
    if (remaining_length_cm === null || remaining_length_cm < 90) throw fail('ROLL_LENGTH_REQUIRED');
    if (detail.length_cm !== null) {
      throw fail('VALIDATION_ERROR', [{ field: 'detail.length_cm', message: '롤은 세로 길이를 보내지 않아요' }]);
    }
  }

  if (detail.has_defect && !detail.defect_note) throw fail('DEFECT_NOTE_REQUIRED');
  const count = detail.sheet_count;
  if (sale_type === 'ROLL' && count != null) {
    throw fail('VALIDATION_ERROR', [{ field: 'detail.sheet_count', message: '롤은 판매 장수를 보내지 않아요' }]);
  }
  if (count != null && (!Number.isInteger(count) || count < 1 || count > 9999)) {
    throw fail('VALIDATION_ERROR', [{ field: 'detail.sheet_count', message: '판매 장수는 1장 이상 9,999장 이하인 정수로 입력해 주세요' }]);
  }
}
