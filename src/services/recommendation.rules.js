// 도안 추천 판정 규칙 (명세서 24번). AI 를 쓰지 않고 모두 코드로 계산하는 순수 함수라서 DB 없이 시험할 수 있다.
// 규칙을 바꿀 때는 이 파일만 고치면 된다.
//  - 부품을 돌리거나(회전) 여러 줄로 놓는 계산은 하지 않는다.
//  - 부품 가로는 원단 폭 방향, 부품 세로는 원단 길이(식서) 방향과 비교한다.

export const ROLL_UNIT_CM = 90; // 롤은 1마(90cm) 단위로 사고판다
export const MAX_SUITABLE = 5; // 적합(SUITABLE) 최대 개수
export const MAX_NEEDS_CHECK = 3; // 확인 필요(NEEDS_CHECK) 최대 개수

export const NOTICE_PHYSICAL_CHECK = '실물 확인 권장: 촉감·결 방향·수축은 정보로 확인할 수 없어요';
export const NOTICE_ASK_MATERIAL = '소재를 판매자에게 확인해 보세요';

const MATERIAL_NAMES = {
  COTTON: '면', LINEN: '린넨', POLYESTER: '폴리에스터', NYLON: '나일론', RAYON: '레이온',
  WOOL: '울', BLEND: '혼방', ETC: '기타', UNKNOWN: '모름',
};
const THICKNESS_NAMES = { THIN: '얇음', NORMAL: '보통', THICK: '두꺼움' };
const names = (map, codes) => codes.map((code) => map[code] ?? code).join(', ');

const sum = (parts, pick) => parts.reduce((total, part) => total + pick(part), 0);

// 도안 하나를 원단에 견주어 본다. 부적합이면 null, 아니면 응답 항목과 정렬용 값을 돌려준다.
// fabric: { sale_type, price, remaining_length_cm, reserved_length_cm }, detail: { width_cm, length_cm, material, thickness }
export function evaluatePattern(fabric, detail, pattern) {
  const parts = pattern.parts ?? [];
  if (parts.length === 0) return null; // 부품이 없으면 크기를 계산할 수 없다

  const reasons = [];
  let item;
  let sortKey;

  if (fabric.sale_type === 'SCRAP') {
    // 모든 부품을 원단 폭 방향으로 한 줄로 나란히 놓는다: 폭 ≥ 부품 가로의 합(장수 포함), 길이 ≥ 부품 세로의 최댓값
    const needWidth = sum(parts, (p) => p.width_cm * p.quantity);
    const needLength = Math.max(...parts.map((p) => p.height_cm));
    if (detail.width_cm < needWidth || detail.length_cm < needLength) return null;
    reasons.push(
      { criterion: 'WIDTH', required: needWidth, actual: detail.width_cm, met: true, text: `필요 가로 ${needWidth}cm 이상 → 폭 ${detail.width_cm}cm (충족)` },
      { criterion: 'LENGTH', required: needLength, actual: detail.length_cm, met: true, text: `필요 세로 ${needLength}cm 이상 → 길이 ${detail.length_cm}cm (충족)` },
    );
    sortKey = -sum(parts, (p) => p.width_cm * p.height_cm * p.quantity); // 필요 면적이 큰 도안부터
    item = { required_length_cm: null, purchase_length_cm: null, yards: null, estimated_price: null };
  } else {
    // 폭 ≥ 부품 가로의 최댓값, 구매 가능 길이(남은 길이 − 확보 길이) ≥ 구매 길이(필요 길이를 90cm 단위로 올림)
    const needWidth = Math.max(...parts.map((p) => p.width_cm));
    const requiredLength = sum(parts, (p) => p.height_cm * p.quantity);
    const yards = Math.ceil(requiredLength / ROLL_UNIT_CM);
    const purchase = yards * ROLL_UNIT_CM;
    const available = fabric.remaining_length_cm - fabric.reserved_length_cm;
    if (detail.width_cm < needWidth || available < purchase) return null;
    reasons.push(
      { criterion: 'WIDTH', required: needWidth, actual: detail.width_cm, met: true, text: `필요 가로 ${needWidth}cm 이상 → 폭 ${detail.width_cm}cm (충족)` },
      { criterion: 'LENGTH', required: purchase, actual: available, met: true, text: `필요 구매 길이 ${purchase}cm(${yards}마) → 구매 가능 길이 ${available}cm (충족)` },
    );
    sortKey = yards; // 필요 마 수가 적은 도안부터
    item = { required_length_cm: requiredLength, purchase_length_cm: purchase, yards, estimated_price: fabric.price * yards };
  }

  // 두께: 허용 두께에 없으면 부적합. 부적합 도안은 목록에 넣지 않는다.
  if (!pattern.allowed_thickness.includes(detail.thickness)) return null;

  // 소재: 허용 소재에 있으면 적합, 원단이 UNKNOWN 이면 확인 필요, 그 밖은 부적합
  let judgement;
  if (detail.material === 'UNKNOWN') {
    judgement = 'NEEDS_CHECK';
    reasons.push({
      criterion: 'MATERIAL', required: pattern.allowed_materials, actual: 'UNKNOWN', met: null,
      text: `허용 소재(${names(MATERIAL_NAMES, pattern.allowed_materials)}) → 원단 소재를 알 수 없어요 (확인 필요)`,
    });
  } else if (pattern.allowed_materials.includes(detail.material)) {
    judgement = 'SUITABLE';
    reasons.push({
      criterion: 'MATERIAL', required: pattern.allowed_materials, actual: detail.material, met: true,
      text: `허용 소재(${names(MATERIAL_NAMES, pattern.allowed_materials)}) → 원단 소재 ${MATERIAL_NAMES[detail.material]} (충족)`,
    });
  } else {
    return null;
  }
  reasons.push({
    criterion: 'THICKNESS', required: pattern.allowed_thickness, actual: detail.thickness, met: true,
    text: `허용 두께(${names(THICKNESS_NAMES, pattern.allowed_thickness)}) → 원단 두께 ${THICKNESS_NAMES[detail.thickness]} (충족)`,
  });

  return {
    judgement,
    sortKey,
    item: {
      patternId: pattern.pattern_id,
      pattern_name: pattern.pattern_name,
      image_url: pattern.image_url,
      judgement,
      reasons,
      ...item,
    },
  };
}

// 사용 중인 도안 전체를 견주어 추천 목록과 안내를 만든다. 적합 최대 5개, 확인 필요 최대 3개. 적합이 먼저 온다.
export function recommend(fabric, detail, patterns) {
  const evaluated = patterns.map((pattern) => ({ pattern, result: evaluatePattern(fabric, detail, pattern) })).filter((e) => e.result);
  const byOrder = (a, b) => a.result.sortKey - b.result.sortKey || a.pattern.pattern_id - b.pattern.pattern_id;
  const pick = (judgement, limit) =>
    evaluated.filter((e) => e.result.judgement === judgement).sort(byOrder).slice(0, limit).map((e) => e.result.item);

  const notices = [NOTICE_PHYSICAL_CHECK];
  if (detail.material === 'UNKNOWN') notices.push(NOTICE_ASK_MATERIAL);
  return { items: [...pick('SUITABLE', MAX_SUITABLE), ...pick('NEEDS_CHECK', MAX_NEEDS_CHECK)], notices };
}
