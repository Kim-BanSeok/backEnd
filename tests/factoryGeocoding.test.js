import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNaverGeocoder, selectGeocodingResult } from '../src/factories/geocoding.js';

const address = '경기도 양주시 은현면 봉암리 422-4번지';
const found = (extra = {}) => ({ jibunAddress: '경기도 양주시 은현면 봉암리 422-4', x: '126.99', y: '37.85', ...extra });
const response = (addresses) => ({ status: 'OK', addresses });

test('지번이 같은 결과의 x는 경도, y는 위도로 저장하고 건물 접미어를 구분한다', () => {
  assert.deepEqual(selectGeocodingResult(address, response([found()])), { status: 'matched', latitude: 37.85, longitude: 126.99, matchedAddress: found().jibunAddress });
  assert.equal(selectGeocodingResult(address + ' A동', response([found()])).status, 'matched');
  assert.equal(selectGeocodingResult(address, response([found({ jibunAddress: '경기도 양주시 은현면 봉암리 422-5' })])).status, 'ambiguous');
});

test('검색 실패·다른 지역·다른 좌표의 중복 결과를 임의 위치로 바꾸지 않는다', () => {
  assert.equal(selectGeocodingResult(address, response([])).status, 'not_found');
  assert.equal(selectGeocodingResult(address, response([found({ jibunAddress: '경기도 의정부시 봉암리 422-4' })])).status, 'ambiguous');
  assert.equal(selectGeocodingResult(address, response([found(), found({ x: '127.05' })])).status, 'ambiguous');
  assert.equal(selectGeocodingResult(address, response([found(), found()])).status, 'matched');
  for (const value of ['', ' ', null, true, 'bad', '200']) assert.equal(selectGeocodingResult(address, response([found({ x: value })])).status, 'ambiguous');
});

test('부번 0의 생략만 허용하며 다른 지번과 혼동하지 않는다', () => {
  const original = '경기도 양주시 은현면 봉암리 44-0';
  const item = found({ jibunAddress: '경기도 양주시 은현면 봉암리 44' });
  assert.equal(selectGeocodingResult(original, response([item])).status, 'matched');
  assert.equal(selectGeocodingResult(original + '번지 A동', response([item])).status, 'matched');
  assert.equal(selectGeocodingResult(item.jibunAddress, response([found({ jibunAddress: original })])).status, 'matched');
  for (const lot of ['44-1', '44-10', '144', '440']) {
    assert.equal(selectGeocodingResult(original, response([found({ jibunAddress: `경기도 양주시 은현면 봉암리 ${lot}` })])).status, 'ambiguous');
  }
});

test('실제 URL과 서버 인증 헤더를 사용하고 호출 제한은 재시도한다', async () => {
  const calls = [], waits = [];
  const geocode = createNaverGeocoder({ clientId: 'test-id', clientSecret: 'test-secret', sleep: async (ms) => waits.push(ms), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response('{}', { status: 429 }) : new Response(JSON.stringify(response([found()])));
  } });
  assert.equal((await geocode(address)).status, 'matched');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.hostname, 'maps.apigw.ntruss.com');
  assert.equal(calls[0].url.searchParams.get('query'), address);
  assert.equal(calls[0].options.headers['x-ncp-apigw-api-key'], 'test-secret');
  assert.deepEqual(waits, [1000]);
});

test('키 누락과 인증 실패는 외부 호출 반복 없이 중단한다', async () => {
  assert.throws(() => createNaverGeocoder({ clientId: '', clientSecret: '' }), /설정/);
  let count = 0;
  const geocode = createNaverGeocoder({ clientId: 'test-id', clientSecret: 'test-secret', fetchImpl: async () => { count++; return new Response('{}', { status: 401 }); } });
  await assert.rejects(geocode(address), { status: 401 });
  assert.equal(count, 1);
});
