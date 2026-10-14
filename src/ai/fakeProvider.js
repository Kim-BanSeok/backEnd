// 개발·시험용 가짜 AI. Claude 키 없이도 AI 등록 흐름을 끝까지 써 볼 수 있다. 키워드 규칙으로 답에서 값을 뽑는다.
// 운영(NODE_ENV=production)에서는 쓸 수 없다. (config/env.js 가 막는다)
// 같은 모양(extract)의 제공자라서 실제 AI(claudeProvider.js)로 바꿔도 services 는 그대로다.

const UNKNOWN_WORDS = /모름|몰라|모르겠|잘 ?모|기억 ?안|기억이 ?안|확실하지 ?않/;
const toInt = (text) => Number(String(text).replace(/,/g, ''));

// "3마" → 270, "1.5마" → 135, "200cm" → 200, "2m" → 200, 단위가 없으면 cm
function lengthsIn(text) {
  const found = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(마|cm|㎝|센티미터|센티|m|미터)?/gi)) {
    const number = Number(match[1]);
    const unit = (match[2] ?? '').toLowerCase();
    const cm = unit === '마' ? number * 90 : unit === 'm' || unit === '미터' ? number * 100 : number;
    found.push({ cm: Math.round(cm), index: match.index, unit });
  }
  return found;
}

// 이름표("가로", "폭", "세로", "길이", "남은") 바로 뒤의 숫자를 찾는다.
const afterLabel = (text, labels) => {
  const match = text.match(new RegExp(`(?:${labels})\\D{0,4}?(\\d+(?:\\.\\d+)?)\\s*(마|cm|㎝|센티|m)?`, 'i'));
  if (!match) return null;
  const number = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  return Math.round(unit === '마' ? number * 90 : unit === 'm' ? number * 100 : number);
};

// 이름표가 없으면 등장한 순서대로 첫 번째를 폭, 두 번째를 길이로 본다. (예: "50에 70", "폭 150에 3마")
// 숫자가 하나뿐이면 폭으로만 보고 길이는 모름으로 둔다. (같은 값을 두 곳에 넣지 않는다)
function parseSize(text, saleType) {
  const numbers = lengthsIn(text).map((l) => l.cm);
  const labeledWidth = afterLabel(text, '가로|폭|너비');
  const labeledLength = afterLabel(text, saleType === 'ROLL' ? '남은 ?길이|길이|남은|세로' : '세로|길이|높이');

  let width = labeledWidth;
  let length = labeledLength;
  if (width === null && length === null) [width = null, length = null] = numbers; // 이름표가 없다
  else if (width === null) width = numbers.find((cm) => cm !== length) ?? null; // 길이만 이름표가 있다
  else if (length === null) length = numbers.find((cm, i) => i > numbers.indexOf(width)) ?? null; // 폭만 이름표가 있다

  return saleType === 'ROLL' ? { width_cm: width, remaining_length_cm: length } : { width_cm: width, length_cm: length };
}

const MATERIAL_WORDS = [
  [/혼방/, 'BLEND'], [/린넨|리넨|삼베/, 'LINEN'], [/폴리/, 'POLYESTER'], [/나일론/, 'NYLON'], [/레이온/, 'RAYON'],
  [/울|양모|모직/, 'WOOL'], [/면|코튼|cotton/i, 'COTTON'], [/기타/, 'ETC'],
];
const COLOR_WORDS = [
  [/남색|네이비|감색/, 'NAVY'], [/하양|하얀|흰|화이트/, 'WHITE'], [/검정|검은|블랙/, 'BLACK'], [/회색|그레이/, 'GRAY'],
  [/베이지|아이보리|크림/, 'BEIGE'], [/갈색|브라운|밤색/, 'BROWN'], [/빨강|빨간|레드/, 'RED'], [/분홍|핑크/, 'PINK'],
  [/노랑|노란|옐로/, 'YELLOW'], [/초록|녹색|그린|연두/, 'GREEN'], [/파랑|파란|블루|하늘/, 'BLUE'], [/보라|퍼플|자주/, 'PURPLE'],
  [/혼합|여러|다양|믹스|체크|줄무늬|프린트/, 'MIXED'],
];
const THICKNESS_WORDS = [[/얇/, 'THIN'], [/두껍|두꺼|도톰/, 'THICK'], [/보통|중간|적당/, 'NORMAL']];
const firstMatch = (words, text) => words.find(([pattern]) => pattern.test(text))?.[1] ?? null;

// "3천 5백원", "1만 2천원", "3,500원", "3000" 처럼 쓴 가격을 숫자로
function parsePrice(text) {
  const plain = text.replace(/,/g, '');
  let total = 0;
  let matched = false;
  for (const [unit, factor] of [['만', 10000], ['천', 1000], ['백', 100]]) {
    const m = plain.match(new RegExp(`(\\d+)\\s*${unit}`));
    if (m) { total += Number(m[1]) * factor; matched = true; }
  }
  if (matched) return total;
  const digits = plain.match(/\d+/);
  return digits ? toInt(digits[0]) : null;
}

const MATERIAL_LABELS = { WOOL: '울', COTTON: '면', LINEN: '린넨', POLYESTER: '폴리에스터', NYLON: '나일론', RAYON: '레이온', BLEND: '혼방', ETC: '기타', UNKNOWN: '소재 확인' };
const COLOR_LABELS = { BEIGE: '아이보리', WHITE: '흰색', BLACK: '검정', GRAY: '회색', BROWN: '갈색', RED: '빨강', PINK: '분홍', YELLOW: '노랑', GREEN: '초록', BLUE: '파랑', NAVY: '네이비', PURPLE: '보라', MIXED: '혼합' };

// 밴드에 올리던 한 줄에서 등록 칸과 소개글을 함께 만든다.
export function parseListing(text) {
  const yardMatch = text.match(/(\d+(?:\.\d+)?)\s*마/);
  const yards = yardMatch ? Number(yardMatch[1]) : null;
  const saleType = yards || /롤|두루마리/.test(text) ? 'ROLL' : /자투리|한\s*장|1\s*장/.test(text) ? 'SCRAP' : null;
  const width = afterLabel(text, '가로|폭|너비');
  const won = text.match(/(\d[\d,]*)\s*원/);
  const total = won ? Number(won[1].replace(/,/g, '')) : null;
  const price = saleType === 'ROLL' && yards && total ? Math.round(total / yards) : total;
  const size = parseSize(text, saleType === 'ROLL' ? 'ROLL' : 'SCRAP');
  const number = text.match(/No\.?\s*(\d+)/i);
  const title = number ? `No.${number[1]}` : text.split(/[,，]/)[0].trim().slice(0, 100) || null;
  const material = firstMatch(MATERIAL_WORDS, text);
  const color = firstMatch(COLOR_WORDS, text);
  const materialLabel = MATERIAL_LABELS[material] || null;
  const colorLabel = COLOR_LABELS[color] || null;
  const spec = [width ? `폭 ${width}cm` : null, materialLabel, colorLabel, yards ? `${yards}마` : null].filter(Boolean).join(' / ');
  const description = [
    title,
    '',
    text.trim(),
    '',
    '원단의 가치',
    materialLabel ? `- ${materialLabel} 소재` : '- 메모에 적힌 소재',
    width ? `- 폭 ${width}cm` : null,
    '',
    '추천 용도',
    '- 셔츠, 원피스, 가방처럼 폭에 맞게 재단해 쓸 수 있어요.',
    '',
    spec,
  ].filter((line) => line !== null).join('\n').slice(0, 5000);
  return {
    sale_type: saleType,
    title,
    width_cm: width,
    length_cm: saleType === 'SCRAP' ? size.length_cm : null,
    remaining_length_cm: saleType === 'ROLL' ? (yards ? Math.round(yards * 90) : size.remaining_length_cm) : null,
    material,
    thickness: firstMatch(THICKNESS_WORDS, text),
    color_family: color,
    has_defect: /얼룩|구멍|오염|흠/.test(text) ? true : false,
    defect_note: null,
    price: price && price >= 1 ? price : null,
    description,
  };
}

const EXTRACTORS = {
  sale_type: (text) => ({ sale_type: /롤|두루마리|마 ?단위/.test(text) ? 'ROLL' : /자투리|조각|한 ?장|1 ?장/.test(text) ? 'SCRAP' : null }),
  title: (text) => ({ title: text.trim() }),
  material: (text) => ({ material: firstMatch(MATERIAL_WORDS, text) }),
  thickness: (text) => ({ thickness: firstMatch(THICKNESS_WORDS, text) }),
  color_family: (text) => ({ color_family: firstMatch(COLOR_WORDS, text) }),
  has_defect: (text) => ({ has_defect: /없|깨끗|괜찮|아니/.test(text) ? false : /있|얼룩|구멍|오염|흠|뜯|찢/.test(text) ? true : null }),
  defect_note: (text) => ({ defect_note: text.trim() }),
  price: (text) => ({ price: parsePrice(text) }),
};

export function createFakeProvider() {
  return {
    name: 'fake',
    model: 'fake-rules',
    // question: { field }, text: 판매자가 쓴 답, draft: 지금까지의 초안
    // 돌려주는 값: { values: { 항목: 값 | null }, usage }. null 은 모름·알아듣지 못함.
    async extract({ question, text, draft }) {
      if (question.field === 'listing') {
        if (UNKNOWN_WORDS.test(text)) {
          return { values: Object.fromEntries(['sale_type', 'title', 'width_cm', 'length_cm', 'remaining_length_cm', 'material', 'thickness', 'color_family', 'has_defect', 'defect_note', 'price', 'description'].map((name) => [name, null])), usage: { input_tokens: 0, output_tokens: 0 } };
        }
        return { values: parseListing(text), usage: { input_tokens: 0, output_tokens: 0 } };
      }
      const fields = question.field === 'size'
        ? (draft.sale_type === 'ROLL' ? ['width_cm', 'remaining_length_cm'] : ['width_cm', 'length_cm'])
        : [question.field];
      // "모름"이라고 답하면 이 질문의 모든 항목을 모름으로 둔다.
      if (UNKNOWN_WORDS.test(text) && question.field !== 'title' && question.field !== 'defect_note') {
        return { values: Object.fromEntries(fields.map((name) => [name, null])), usage: { input_tokens: 0, output_tokens: 0 } };
      }
      const values = question.field === 'size' ? parseSize(text, draft.sale_type) : EXTRACTORS[question.field](text);
      return { values, usage: { input_tokens: 0, output_tokens: 0 } };
    },
    // 사진은 보지 않는다. 키 없이 화면을 붙일 때 빈 초안을 돌려준다.
    async describeImage() {
      return {
        values: { title: null, material: null, thickness: null, color_family: null, has_defect: null, defect_note: null },
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
    async draftPattern({ itemName, fabric }) {
      const limitWidth = Math.max(2, Number(fabric.width_cm) || 20);
      const limitHeight = Math.max(2, Number(fabric.length_cm || fabric.remaining_length_cm) || 30);
      const fit = (width, height) => ({ width_cm: Math.min(width, limitWidth), height_cm: Math.min(height, limitHeight) });
      if (/슬리퍼|실내화|덧신/.test(itemName)) {
        return {
          title: `${itemName} 재단 도안 (실물 크기)`,
          parts: [
            { part_name: '바닥', ...fit(27.5, 11.8), quantity: 2, grain: '폭 방향', outline: 'sole', note: '겉감 1장 · 안감 1장' },
            { part_name: '갑피', ...fit(18.4, 10.9), quantity: 2, grain: '폭 방향', outline: 'upper', note: '결감 1장 · 안감 1장' },
          ],
          notions: [{ name: '시접', note: '재단선 안쪽 1cm' }],
          steps: ['겉감과 안감을 시접에 맞춰 겹친다', '곡선을 따라 재단한다'],
        };
      }
      const body = fit(20, 15);
      return {
        title: `${itemName} 재단 도안`,
        parts: [
          { part_name: '겉감', ...body, quantity: 2, grain: '폭 방향', outline: 'rect', note: '실선 재단' },
          { part_name: '안감', ...body, quantity: 2, grain: '폭 방향', outline: 'rect', note: '실선 재단' },
        ],
        notions: [{ name: '시접', note: '재단선 안쪽 1cm' }],
        steps: [],
      };
    },
    async describeProduct({ text }) {
      const title = text.split('\n').find(line => line.startsWith('소재·원단 종류:'))?.slice('소재·원단 종류:'.length).trim().slice(0, 100) || '자투리 원단';
      return {
        values: {
          title,
          description: `${title}\n\n사진과 입력한 두께, 치수를 바탕으로 정리한 소개입니다.\n작은 소품과 부분 활용을 검토해 보세요.`,
          color_family: null,
          seller_note: '',
        },
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    },
  };
}
