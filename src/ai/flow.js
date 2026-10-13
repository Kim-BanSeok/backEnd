import { SALE_TYPES, MATERIALS, THICKNESSES, COLOR_FAMILIES } from '../utils/codes.js';

// AI 보조 등록의 질문 순서와 답변 정리 규칙 (명세서 17~21번, 6.4). AI 도 DB 도 쓰지 않는 순수 함수다.
// 질문 순서는 서버가 정한다: 판매 형태 → 이름 → 가로·세로(롤은 폭·남은 길이) → 소재 → 두께 → 색상 → 하자 → 가격.
// next_question 은 세션에 저장하지 않고, 세션의 sale_type·ai_draft·unconfirmed_fields 를 보고 매번 계산한다.

export const PROMPT_VERSION = 'p2';
const INT_MAX = 2147483647;

export const FIELD_OPTIONS = {
  sale_type: SALE_TYPES,
  material: MATERIALS,
  thickness: THICKNESSES,
  color_family: COLOR_FAMILIES,
  has_defect: ['true', 'false'],
};

const SCRAP_SIZE_FIELDS = ['width_cm', 'length_cm'];
const ROLL_SIZE_FIELDS = ['width_cm', 'remaining_length_cm'];

// 판매자가 원단을 한 번 적으면, 이 질문의 답에서 등록 항목과 소개글을 함께 만든다.
export const LISTING_QUESTION = {
  field: 'listing',
  text: '어떤 원단인지 편하게 적어 주세요. 자투리인지, 크기, 소재, 색, 가격을 한 번에 적어도 돼요. 예를 들면 네이비 면 자투리 50에 70, 한 장에 7천원이요.',
};

// 질문 단계. 한 줄 설명을 받기 전에는 쓰지 않는다. fields 는 그 단계의 답이 채우는 ai_draft 항목이다.
const STEPS = [
  { field: 'sale_type', text: '안녕하세요. 자투리 한 장인가요, 아니면 롤 원단인가요?', options: SALE_TYPES, fields: () => ['sale_type'] },
  { field: 'title', text: '원단 이름은 뭐라고 할까요? 예를 들면 네이비 면 20수요.', fields: () => ['title'] },
  {
    field: 'size',
    // 판매 형태를 모르면 크기를 물을 수 없다.
    skip: (draft) => !draft.sale_type,
    text: (draft) =>
      draft.sale_type === 'ROLL'
        ? '폭과 남은 길이는 어느 정도예요? 예를 들면 폭 150에 3마요. 1마는 90센티미터예요.'
        : '가로(폭)와 세로는 어느 정도예요? 센티미터로 말씀해 주세요. 예를 들면 50에 70이요.',
    fields: (draft) => (draft.sale_type === 'ROLL' ? ROLL_SIZE_FIELDS : SCRAP_SIZE_FIELDS),
  },
  { field: 'material', text: '소재는 뭐예요? 면이나 울처럼 말씀해 주세요.', options: MATERIALS, fields: () => ['material'] },
  { field: 'thickness', text: '두께는 어때요? 얇은 편, 보통, 두꺼운 편 중에 말씀해 주세요.', options: THICKNESSES, fields: () => ['thickness'] },
  { field: 'color_family', text: '색은 어느 쪽에 가까워요?', options: COLOR_FAMILIES, fields: () => ['color_family'] },
  { field: 'has_defect', text: '얼룩이나 구멍 같은 하자가 있나요?', options: FIELD_OPTIONS.has_defect, fields: () => ['has_defect'] },
  {
    field: 'defect_note',
    skip: (draft) => draft.has_defect !== true, // 하자가 있다고 한 경우에만 묻는다
    text: '하자가 어디에 있고, 어느 정도예요?',
    fields: () => ['defect_note'],
  },
  {
    field: 'price',
    text: (draft) => (draft.sale_type === 'ROLL' ? '90센티미터, 1마당 가격은 얼마예요?' : '이 한 장은 얼마에 팔까요?'),
    fields: () => ['price'],
  },
];

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
  if (!session.flags.listing_done) return { ...LISTING_QUESTION };
  const { ai_draft: draft, unconfirmed_fields: unconfirmed } = session;

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
  description: (v) => (typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 5000 ? v.trim() : null),
};

const LISTING_FIELDS = ['sale_type', 'title', 'width_cm', 'length_cm', 'remaining_length_cm', 'material', 'thickness', 'color_family', 'has_defect', 'defect_note', 'price', 'description'];

// AI(또는 가짜 AI)가 뽑은 값을 초안에 반영한다. values 에 없거나 null 이거나 올바르지 않은 항목은 "모름"으로 본다.
//  - 모름: 비워 두고(소재는 UNKNOWN) unconfirmed_fields 에 넣는다. 판매자가 확인·수정 화면에서 채운다.
//  - 이렇게 해야 AI 가 알아듣지 못해도 같은 질문이 끝없이 반복되지 않는다.
export function applyValues(session, question, values) {
  const draft = session.ai_draft;
  const stepFields = question.field === 'listing' ? LISTING_FIELDS : STEPS.find((s) => s.field === question.field).fields(draft);

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
    } else {
      setValue(session, name, value);
      if (name === 'has_defect' && value === false) dropValue(session, 'defect_note');
    }
  }
  if (question.field === 'listing') {
    session.flags.listing_done = true;
    const type = session.ai_draft.sale_type;
    if (type === 'ROLL') { dropValue(session, 'length_cm'); clearUnconfirmed(session, 'length_cm'); }
    if (type === 'SCRAP') { dropValue(session, 'remaining_length_cm'); clearUnconfirmed(session, 'remaining_length_cm'); }
    if (session.ai_draft.has_defect !== true) clearUnconfirmed(session, 'defect_note');
    for (const step of STEPS) {
      for (const name of step.fields(session.ai_draft)) {
        const unusedLength = (type === 'ROLL' && name === 'length_cm') || (type === 'SCRAP' && name === 'remaining_length_cm');
        const unusedDefect = name === 'defect_note' && session.ai_draft.has_defect !== true;
        if (!unusedLength && !unusedDefect && session.ai_draft[name] === undefined) markUnconfirmed(session, name);
      }
    }
  }
  if (session.ai_draft.length_cm >= 1 || session.ai_draft.remaining_length_cm !== undefined) session.flags.size_hint = null;
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
