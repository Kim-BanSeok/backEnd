import { fail } from '../utils/errors.js';

// API 명세서 9번 "처리 규칙"을 코드로 옮긴 것. 원단 등록·수정·AI 등록 확정이 같은 함수를 쓴다.
// (조회 때 값 범위 오류는 오류 코드로 알려야 해서 zod 가 아니라 여기서 검사한다)
export function assertFabricRules({ sale_type, remaining_length_cm, detail }) {
  if (sale_type === 'SCRAP') {
    // 자투리: 세로 길이 30~90cm 필수, 남은 길이는 보내지 않는다.
    const length = detail.length_cm;
    if (length === null || length < 30 || length > 90) throw fail('SCRAP_LENGTH_OUT_OF_RANGE');
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
}
