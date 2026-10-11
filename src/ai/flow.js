import { SALE_TYPES, MATERIALS, THICKNESSES, COLOR_FAMILIES } from '../utils/codes.js';

// AI 보조 등록의 질문 순서와 답변 정리 규칙 (명세서 17~21번, 6.4). AI 도 DB 도 쓰지 않는 순수 함수다.
// 질문 순서는 서버가 정한다: 판매 형태 → 이름 → 가로·세로(롤은 폭·남은 길이) → 소재 → 두께 → 색상 → 하자 → 가격.
// next_question 은 세션에 저장하지 않고, 세션의 sale_type·ai_draft·unconfirmed_fields 를 보고 매번 계산한다.

export const PROMPT_VERSION = 'p1';
const INT_MAX = 2147483647;
const ROLL_UNIT_CM = 90;

export const FIELD_OPTIONS = {
  sale_type: SALE_TYPES,
  material: MATERIALS,
  thickness: THICKNESSES,
  color_family: COLOR_FAMILIES,
  has_defect: ['true', 'false'],
};

const SCRAP_SIZE_FIELDS = ['width_cm', 'length_cm'];
const ROLL_SIZE_FIELDS = ['width_cm', 'remaining_length_cm'];

// 질문 단계. fields 는 그 단계의 답이 채우는 ai_draft 항목이다. 이미 채웠거나 "모름"으로 표시한 항목은 다시 묻지 않는다.
const STEPS = [
  { field: 'sale_type', text: '자투리 1장인가요, 롤 원단인가요?', options: SALE_TYPES, fields: () => ['sale_type'] },
  { field: 'title', text: '원단 이름(제목)을 알려 주세요. 예: 네이비 면 20수', fields: () => ['title'] },
  {
    field: 'size',
    // 판매 형태를 모르면 크기를 물을 수 없다.
    skip: (draft) => !draft.sale_type,
    text: (draft) =>
      draft.sale_type === 'ROLL'
        ? '폭과 남은 길이를 알려 주세요. 예: 폭 150에 3마 (1마는 90cm예요)'
        : '가로(폭)와 세로 길이를 알려 주세요. 예: 50에 70 (cm)',
    fields: (draft) => (draft.sale_type === 'ROLL' ? ROLL_SIZE_FIELDS : SCRAP_SIZE_FIELDS),
  },
  { field: 'material', text: '소재는 무엇인가요?', options: MATERIALS, fields: () => ['material'] },
  { field: 'thickness', text: '두께는 어떤가요?', options: THICKNESSES, fields: () => ['thickness'] },
  { field: 'color_family', text: '색상 계열은 무엇인가요?', options: COLOR_FAMILIES, fields: () => ['color_family'] },
  { field: 'has_defect', text: '하자(얼룩·구멍 등)가 있나요?', options: FIELD_OPTIONS.has_defect, fields: () => ['has_defect'] },
  {
    field: 'defect_note',
    skip: (draft) => draft.has_defect !== true, // 하자가 있다고 한 경우에만 묻는다
    text: '하자의 위치와 내용을 알려 주세요. 예: 오른쪽 아래 얼룩 3cm',
    fields: () => ['defect_note'],
  },
  {
    field: 'price',
    text: (draft) => (draft.sale_type === 'ROLL' ? '가격은 얼마인가요? (롤은 90cm(1마)당 원)' : '가격은 얼마인가요? (자투리는 장당 원)'),
    fields: () => ['price'],
  },
];

// 자투리 길이가 90cm 를 넘으면 롤로 등록할지 묻는다. (한 번만 묻는다)
const ROLL_OFFER = {
  field: 'sale_type',
  text: '세로 길이가 90cm를 넘어요. 롤로 등록할까요?',
  options: ['ROLL', 'SCRAP'],
};

const stepText = (step, draft) => (typeof step.text === 'function' ? step.text(draft) : step.text);
const toQuestion = (step, draft, textOverride) => ({
  field: step.field,
  text: textOverride ?? stepText(step, draft),
  ...(step.options && { options: step.options }),
});

export function newSession({ sellerId, now, model, promptVersion = PROMPT_VERSION }) {
  return {
    seller_id: sellerId,
    fabric_id: null,
    sale_type: null,
    messages: [],
    ai_draft: {},
    final_data: null,
    unconfirmed_fields: [],
    session_status: 'IN_PROGRESS',
    prompt_version: promptVersion,
    ai_model: model,
    call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    started_at: now,
    last_updated_at: now,
    flags: { finished: false, roll_declined: false, size_hint: null }, // 서버 안에서만 쓰는 값 (응답에 넣지 않는다)
  };
}

// 지금 물어볼 질문. 더 물을 것이 없거나 끝난 세션이면 null.
export function currentQuestion(session) {
  if (session.session_status !== 'IN_PROGRESS' || session.flags.finished) return null;
  const { ai_draft: draft, unconfirmed_fields: unconfirmed } = session;

  if (draft.sale_type === 'SCRAP' && draft.length_cm > ROLL_UNIT_CM && !session.flags.roll_declined) return ROLL_OFFER;

  for (const step of STEPS) {
    if (step.skip?.(draft)) continue;
    const pending = step.fields(draft).some((name) => draft[name] === undefined && !unconfirmed.includes(name));
    if (!pending) continue;
    return toQuestion(step, draft, step.field === 'size' ? session.flags.size_hint ?? undefined : undefined);
  }
  return null;
}

export const isComplete = (session) => currentQuestion(session) === null;

// 응답에 담는 세션 모양 (명세서 17, 19번). 저장하지 않은 next_question 을 지금 상태로 계산해 붙인다.
export function toView(session) {
  const next = currentQuestion(session);
  return {
    session_status: session.session_status,
    next_question: next,
    ai_draft: session.ai_draft,
    unconfirmed_fields: session.unconfirmed_fields,
    is_complete: next === null,
  };
}

// ---- 답을 받아 초안에 반영한다

const markUnconfirmed = (session, name) => {
  if (!session.unconfirmed_fields.includes(name)) session.unconfirmed_fields.push(name);
};
const clearUnconfirmed = (session, name) => {
  session.unconfirmed_fields = session.unconfirmed_fields.filter((field) => field !== name);
};
const setValue = (session, name, value) => {
  session.ai_draft[name] = value;
  clearUnconfirmed(session, name);
};
const dropValue = (session, name) => {
  delete session.ai_draft[name];
  clearUnconfirmed(session, name);
};

// 판매 형태를 정하거나 바꾼다. 자투리 ↔ 롤을 오가면 그 판매 형태에 없는 항목은 지운다.
function setSaleType(session, value) {
  const draft = session.ai_draft;
  const before = draft.sale_type;

  // 롤 제안(자투리 길이 90cm 초과)에 답한 경우
  if (before === 'SCRAP' && value === 'SCRAP' && draft.length_cm > ROLL_UNIT_CM) session.flags.roll_declined = true;

  setValue(session, 'sale_type', value);
  session.sale_type = value;
  if (before && before !== value) {
    session.flags.size_hint = null;
    dropValue(session, value === 'ROLL' ? 'length_cm' : 'remaining_length_cm'); // 새 판매 형태에 없는 길이는 지운다
  }
}

// 한 항목의 값을 정리한다. 올바르지 않으면 null (소재는 UNKNOWN) — 호출하는 쪽이 unconfirmed_fields 에 넣는다.
const isInt = (value, min, max = INT_MAX) => Number.isInteger(value) && value >= min && value <= max;
const SANITIZERS = {
  sale_type: (v) => (SALE_TYPES.includes(v) ? v : null),
  title: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100 ? v.trim() : null),
  width_cm: (v) => (isInt(v, 1, 1000) ? v : null),
  length_cm: (v) => (isInt(v, 1) ? v : null),
  remaining_length_cm: (v) => (isInt(v, 1) ? v : null),
  material: (v) => (MATERIALS.includes(v) ? v : null),
  thickness: (v) => (THICKNESSES.includes(v) ? v : null),
  color_family: (v) => (COLOR_FAMILIES.includes(v) ? v : null),
  has_defect: (v) => (typeof v === 'boolean' ? v : null),
  defect_note: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 255 ? v.trim() : null),
  price: (v) => (isInt(v, 1) ? v : null),
};

// AI(또는 가짜 AI)가 뽑은 값을 초안에 반영한다. values 에 없거나 null 이거나 올바르지 않은 항목은 "모름"으로 본다.
//  - 모름: 비워 두고(소재는 UNKNOWN) unconfirmed_fields 에 넣는다. 판매자가 확인·수정 화면에서 채운다.
//  - 이렇게 해야 AI 가 알아듣지 못해도 같은 질문이 끝없이 반복되지 않는다.
export function applyValues(session, question, values) {
  const draft = session.ai_draft;
  const stepFields = question === ROLL_OFFER ? ['sale_type'] : STEPS.find((s) => s.field === question.field).fields(draft);

  for (const name of stepFields) {
    const value = SANITIZERS[name](values?.[name]);
    if (value === null) {
      if (name === 'material') draft.material = 'UNKNOWN'; // 소재를 모르면 UNKNOWN
      else if (name === 'sale_type' && draft.sale_type) continue; // 롤 제안에 못 알아들었으면 지금 값을 유지
      markUnconfirmed(session, name);
      continue;
    }
    if (name === 'sale_type') {
      setSaleType(session, value);
    } else if (name === 'length_cm' && session.ai_draft.sale_type === 'SCRAP' && value < 30) {
      // 자투리는 길이가 30cm 이상이어야 등록할 수 있다. 값은 받지 않고 같은 질문을 안내와 함께 다시 한다.
      session.flags.size_hint = '30cm 이상만 등록할 수 있어요. 세로 길이를 다시 알려 주세요';
      dropValue(session, 'length_cm');
    } else {
      setValue(session, name, value);
      if (name === 'has_defect' && value === false) dropValue(session, 'defect_note');
    }
  }
  if (session.ai_draft.length_cm >= 30 || session.ai_draft.remaining_length_cm !== undefined) session.flags.size_hint = null;
  return session;
}

// 선택 버튼으로 고른 값을 받는다. AI 를 부르지 않는다. 지금 질문의 선택 목록에 없으면 null 을 돌려준다.
export function applySelected(session, question, selected) {
  if (!question.options || !question.options.includes(selected)) return null;
  const value = question.field === 'has_defect' ? selected === 'true' : selected;
  return applyValues(session, question, { [question.field]: value });
}

// 마무리: 더 묻지 않고 지금까지의 초안을 보여 준다. (is_complete 가 true)
export function finish(session) {
  session.flags.finished = true;
  return session;
}

export const COMPLETE_MESSAGE = '필요한 내용을 모두 확인했어요. 내용을 살펴보고 고친 뒤에 등록해 주세요.';
