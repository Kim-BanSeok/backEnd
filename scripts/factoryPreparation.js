// DB 접속 없이 원문, 중복 근거와 부자재 후보를 정리한다. API의 업종 분류는 변경하지 않는다.
import { createHash } from 'node:crypto';
import { classifyIndustry } from '../src/factories/categories.js';

export const PREPARATION_VERSION = 1;
const LIMITS = { factory_name: 100, address: 255, industry: 100 };
const digest = (value) => createHash('sha256').update(value).digest('hex');
export const normalizeFactoryText = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const compact = (value) => normalizeFactoryText(value).replace(/\s+/gu, '').toLowerCase();

// 기존 적재기의 회사명+주소 기준과 같으며, 기준월·행 번호·환경별 숫자 ID에 의존하지 않는다.
export function factorySourceKey(name, address) {
  return `yangju:${digest(JSON.stringify([compact(name), compact(address)]))}`;
}

const SUPPLY_RULES = [
  { code: 'BUTTON', pattern: /단추/u },
  { code: 'ZIPPER', pattern: /지퍼/u },
  { code: 'FASTENER', pattern: /버클|파스너|화스너|스냅단추|벨크로|찍찍이/u },
  { code: 'SEWING_THREAD', pattern: /재봉사|봉제사|재봉실|봉제실/u },
  { code: 'LACE', pattern: /레이스(?!웨이)/u },
  { code: 'RIBBON', pattern: /리본/u },
  { code: 'INTERLINING', pattern: /심지|심테이프/u },
  { code: 'TEXTILE_LABEL', pattern: /직조라벨|섬유라벨|의류라벨|의류등의섬유라벨|세폭직물\(라벨지\)/u },
  { code: 'GARMENT_CORD', pattern: /의류부자재.*끈|가방끈|헬멧끈|마스크끈|귀끈/u },
  { code: 'GARMENT_TRIM', pattern: /의류부자재|가방의류부자재|옷부착부자재|마스크원부자재/u },
];
const REVIEW_RULES = [
  { code: 'CORD', pattern: /끈|로프/u },
  { code: 'LABEL', pattern: /라벨/u },
  { code: 'WEBBING', pattern: /웨빙/u },
  { code: 'BAND', pattern: /밴드|벤드|고무사/u },
  { code: 'YARN', pattern: /원사|연사/u },
  { code: 'TRIM', pattern: /부자재/u },
];
const EXCLUSIONS = [
  { code: 'ELECTRONIC_OR_PAPER_LABEL', pattern: /전자라벨|산업용라벨|티켓|스티커/u, only: /라벨/u },
  { code: 'ELECTRICAL_RACEWAY', pattern: /레이스웨이/u, only: /레이스웨이/u },
  { code: 'OTHER_INDUSTRY_TRIM', pattern: /커튼봉|커튼링|커튼부자재|가구부자재|화장품부자재|판넬.*부자재/u, only: /부자재/u },
  { code: 'WIG_YARN', pattern: /가발.*원사/u, only: /원사/u },
];

// 생산품에서 추론한 후보이며 판매 여부, 영업 여부, 소매 공급 가능 여부를 확정하지 않는다.
export function identifySupplyProducts(industry) {
  const text = compact(industry);
  const direct = SUPPLY_RULES.filter((rule) => rule.pattern.test(text));
  const review = REVIEW_RULES.filter((rule) => rule.pattern.test(text));
  const exclusions = EXCLUSIONS.filter((rule) => rule.pattern.test(text) && rule.only.test(text));
  const directIndependentOfExclusion = direct.filter((rule) => !['TEXTILE_LABEL', 'LACE', 'GARMENT_TRIM'].includes(rule.code));
  const status = direct.length && (!exclusions.length || directIndependentOfExclusion.length)
    ? 'candidate' : exclusions.length ? 'excluded' : review.length ? 'review' : 'unmatched';
  return {
    status,
    matches: [...direct, ...review].map((rule) => ({ code: rule.code, evidence: text.match(rule.pattern)[0] })),
    exclusions: exclusions.map((rule) => rule.code),
  };
}

export function verifyFactorySource(bytes, source) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(source.datasetMonth)) throw new Error('자료 기준월이 올바르지 않습니다.');
  if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error('원본 SHA-256이 필요합니다.');
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength <= 0) throw new Error('원본 파일 크기가 필요합니다.');
  if (bytes.length !== source.byteLength || digest(bytes) !== source.sha256) throw new Error('원본 크기 또는 SHA-256이 출처 기록과 다릅니다.');
  if (!bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) throw new Error('원본이 XLS 형식이 아닙니다.');
}

function columnsOf(matrix, datasetMonth) {
  const [year, month] = datasetMonth.split('-').map(Number);
  const title = normalizeFactoryText(matrix[0]?.[0]);
  const match = /(?:\b(\d{4})|['’]?(\d{2}))\.?\s*(\d{1,2})월말/u.exec(title);
  if (!match || Number(match[1] || `20${match[2]}`) !== year || Number(match[3]) !== month) {
    throw new Error('엑셀 제목의 기준월이 출처 기록과 다릅니다.');
  }
  const index = matrix.findIndex((row) => row.some((cell) => compact(cell) === '회사명'));
  if (index < 0) throw new Error('회사명 헤더를 찾지 못했습니다.');
  const header = matrix[index].map(compact);
  const field = (name) => header.findIndex((cell) => cell.includes(name));
  const columns = { factory_name: field('회사명'), address: field('소재지'), industry: field('생산품') };
  if (Object.values(columns).some((value) => value < 0)) throw new Error('회사명·소재지·생산품 헤더가 필요합니다.');
  return { index, columns };
}

export function prepareFactoryData(matrix, source) {
  const { index, columns } = columnsOf(matrix, source.datasetMonth);
  const groups = new Map();
  const rejected = [];
  let blankRows = 0;
  let inputRows = 0;
  for (let i = index + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (cells.every((value) => !normalizeFactoryText(value))) { blankRows++; continue; }
    inputRows++;
    const raw = Object.fromEntries(Object.entries(columns).map(([field, column]) => [field, String(cells[column] ?? '')]));
    const normalized = Object.fromEntries(Object.entries(raw).map(([field, value]) => [field, normalizeFactoryText(value)]));
    if (!normalized.factory_name || !normalized.address) {
      rejected.push({ sourceRow: i + 1, raw, reason: 'MISSING_NAME_OR_ADDRESS' });
      continue;
    }
    const key = factorySourceKey(normalized.factory_name, normalized.address);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ sourceRow: i + 1, raw, normalized });
  }

  const records = [...groups].map(([sourceKey, entries]) => {
    const products = [...new Set(entries.map((entry) => entry.normalized.industry).filter(Boolean))].sort();
    const first = entries[0].normalized;
    const industry = products.join(' / ') || null;
    const record = { factory_name: first.factory_name, address: first.address, industry };
    const issues = [];
    if (products.length > 1) issues.push('DUPLICATE_PRODUCT_CONFLICT');
    if (!industry) issues.push('MISSING_PRODUCT');
    if (!/^경기도 양주시(?:\s|$)/u.test(record.address)) issues.push('ADDRESS_OUTSIDE_YANGJU');
    for (const [field, limit] of Object.entries(LIMITS)) {
      if ([...(record[field] || '')].length > limit) issues.push(`${field.toUpperCase()}_EXCEEDS_DB_LIMIT`);
    }
    return {
      sourceKey,
      ...record,
      products,
      sourceRows: entries.map((entry) => entry.sourceRow),
      raw: entries.map((entry) => ({ sourceRow: entry.sourceRow, ...entry.raw })),
      category: classifyIndustry(industry),
      supply: identifySupplyProducts(industry),
      issues,
      importEligible: !issues.some((issue) => issue !== 'MISSING_PRODUCT'),
      latitude: null,
      longitude: null,
      geocodingStatus: 'pending',
    };
  }).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey, 'en'));

  const counts = (items, getKey) => {
    const result = {};
    for (const item of items) {
      const key = getKey(item);
      result[key] = (result[key] || 0) + 1;
    }
    return result;
  };
  const duplicateGroups = records.filter((record) => record.sourceRows.length > 1);
  const issueCounts = counts(records.flatMap((record) => record.issues), (issue) => issue);
  const importRows = records.filter((record) => record.importEligible).map((record) => ({
    sourceKey: record.sourceKey,
    factory_name: record.factory_name,
    industry: record.industry,
    address: record.address,
    latitude: null,
    longitude: null,
    data_source: `양주시청 공장등록 ${source.datasetMonth}`,
  }));
  return {
    preparationVersion: PREPARATION_VERSION,
    source,
    summary: {
      inputRows,
      blankRows,
      rejectedRows: rejected.length,
      uniqueFactories: records.length,
      duplicateRows: inputRows - rejected.length - records.length,
      duplicateGroups: duplicateGroups.length,
      productConflictGroups: issueCounts.DUPLICATE_PRODUCT_CONFLICT || 0,
      eligibleForCurrentSchema: importRows.length,
      heldForReview: records.length - importRows.length,
      missingCoordinates: records.length,
      categoryCounts: counts(records, (record) => record.category),
      supplyCounts: counts(records, (record) => record.supply.status),
      issueCounts,
    },
    records,
    importRows,
    rejected,
  };
}

export function renderPreparationReport(result) {
  const { source, summary, records } = result;
  const cell = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const table = (headers, rows) => [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
  const candidates = records.filter((record) => record.supply.status === 'candidate');
  const review = records.filter((record) => record.supply.status === 'review');
  const excluded = records.filter((record) => record.supply.status === 'excluded');
  const productConflicts = records.filter((record) => record.issues.includes('DUPLICATE_PRODUCT_CONFLICT'));
  const longProducts = records.filter((record) => record.issues.includes('INDUSTRY_EXCEEDS_DB_LIMIT'));
  return [
    `# 양주시 공장등록 자료 정제 결과 ${source.datasetMonth}`,
    '',
    `출처: [${source.title}](${source.postUrl}) · ${source.publisher} · 게시일 ${source.publishedOn}`,
    '',
    `원본 SHA-256: \`${source.sha256}\``,
    '',
    '## 원본 대조',
    '',
    table(['항목', '건수'], [
      ['원본 등록 행', summary.inputRows], ['회사명·주소 그룹', summary.uniqueFactories],
      ['중복 추가 행', summary.duplicateRows], ['중복 그룹', summary.duplicateGroups],
      ['필수값 누락으로 제외한 행', summary.rejectedRows], ['빈 행', summary.blankRows],
      ['현재 DB 길이·중복 검사 통과', summary.eligibleForCurrentSchema], ['적재 보류 그룹', summary.heldForReview],
    ]),
    '',
    '자동 DB 적재는 수행하지 않았습니다. 생산품 원문을 자르지 않으며, 다른 생산품을 가진 중복과 DB 길이 초과 항목을 보류합니다.',
    '',
    `## 부자재 후보 ${candidates.length}곳`,
    '',
    '생산품 문구를 기준으로 선별했습니다. 소매 판매, 영업 여부, 협력 업체 등록을 확인한 목록은 아닙니다. 좌표는 아직 없습니다.',
    '',
    table(['회사명', '생산품', '주소'], candidates.map((record) => [record.factory_name, record.industry, record.address])),
    '',
    `## 용도 확인 대상 ${review.length}곳`,
    '',
    '일반 끈·라벨·원사·연사·웨빙·밴드는 의류 제작용 부자재인지 추가 확인합니다.',
    '',
    table(['회사명', '생산품'], review.map((record) => [record.factory_name, record.industry])),
    '',
    `## 부자재 관련 검색어가 있으나 제외한 ${excluded.length}곳`,
    '',
    table(['회사명', '생산품', '제외 근거'], excluded.map((record) => [record.factory_name, record.industry, record.supply.exclusions.join(', ')])),
    '',
    `## 생산품이 다른 중복 ${productConflicts.length}그룹`,
    '',
    '동일 회사명·주소에서 서로 다른 생산품이 나옵니다. 임의의 마지막 행으로 덮어쓰지 않고 원본 행을 모두 보존했습니다.',
    '',
    table(['회사명', '엑셀 행 번호', '생산품 원문'], productConflicts.map((record) => [record.factory_name, record.sourceRows.join(', '), record.products.join(' / ')])),
    '',
    `## 현재 생산품 컬럼 100자를 넘는 ${longProducts.length}건`,
    '',
    table(['회사명', '엑셀 행 번호', '정제 후 글자 수'], longProducts.map((record) => [record.factory_name, record.sourceRows.join(', '), [...record.industry].length])),
    '',
    '## 다음 적재 단계',
    '',
    `현재 DB 한도를 넘는 생산품 ${longProducts.length}건의 원문 보존 방식과 충돌 중복 ${productConflicts.length}그룹의 처리 규칙을 확인합니다. 부자재 후보 ${candidates.length}곳 중 ${candidates.filter((record) => record.importEligible).length}곳은 현재 스키마 검사에 맞습니다.`,
    '',
    '숫자 factoryId와 별도로 회사명·주소에서 생성한 sourceKey를 보존했습니다. 로컬에서 생성하는 좌표 결과는 이 키로 공용 환경의 동일 업체에 연결할 수 있습니다.',
    '',
  ].join('\n');
}
