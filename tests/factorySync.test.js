import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factoryKey, planFactoryChanges, readFactoryRows } from '../scripts/factorySync.js';

const matrix = [
  ["공장등록현황('26. 9월말)"],
  ['연번', '회사명', '소재지(지번)', '종업원수', '생산품', '전화번호', 'FAX', '법정동'],
  [1, '(주)라움푸드', '경기도 양주시 고암동 526-2', '6', '즉석조리식품', '', '', '고암동'],
  [2, '빈칸', '', '0', '', '', '', ''],
  [3, '(주)라움푸드', '경기도 양주시 고암동 526-2', '6', '즉석조리식품', '', '', '고암동'],
  [4, '새공장', '경기도 양주시 고암동 1', '1', '원단', '', '', '고암동'],
];

test('엑셀에서 회사명·주소·생산품만 읽고 빈 행과 파일 안 중복을 가린다', () => {
  const parsed = readFactoryRows(matrix);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.duplicateInFile, 1);
  assert.deepEqual(parsed.rows, [
    { factory_name: '(주)라움푸드', address: '경기도 양주시 고암동 526-2', industry: '즉석조리식품' },
    { factory_name: '새공장', address: '경기도 양주시 고암동 1', industry: '원단' },
  ]);
});

test('같은 공장은 생산품이 바뀔 때만 수정하고, 없는 공장만 추가한다', () => {
  const existing = [
    { factory_id: 10, factory_name: '(주)라움푸드', address: '경기도 양주시 고암동 526-2', industry: '즉석조리식품' },
    { factory_id: 11, factory_name: '바뀐공장', address: '경기도 양주시 남면 1', industry: '섬유' },
  ];
  const incoming = [
    { factory_name: '(주) 라움푸드', address: '경기도  양주시 고암동 526-2', industry: '즉석조리식품' },
    { factory_name: '바뀐공장', address: '경기도 양주시 남면 1', industry: '원단가공' },
    { factory_name: '새공장', address: '경기도 양주시 고암동 1', industry: '원단' },
  ];
  assert.equal(factoryKey(existing[0].factory_name, existing[0].address), factoryKey(incoming[0].factory_name, incoming[0].address));
  const plan = planFactoryChanges(existing, incoming);
  assert.equal(plan.unchanged, 1);
  assert.deepEqual(plan.update, [{ factory_id: 11, industry: '원단가공' }]);
  assert.deepEqual(plan.insert, [incoming[2]]);
});
