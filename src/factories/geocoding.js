// 양주시 지번 원본과 정확히 맞는 주소만 채택한다. 근처 검색 결과를 임의로 선택하지 않는다.
const compact = (value) => String(value || '').normalize('NFKC').replace(/\s|번지/gu, '').toLowerCase();
const lotAddress = (value) => {
  const match = String(value || '').normalize('NFKC').match(/^(경기도\s+양주시\s+.+?\s+\d+(?:-\d+)?)(?:번지)?(?:\s|$)/u);
  // 부번이 0인 원본 지번(44-0)은 네이버에서 본번만(44) 반환된다.
  return match ? compact(match[1].replace(/-0$/u, '')) : compact(value);
};

export function selectGeocodingResult(address, raw) {
  if (raw?.status !== 'OK' || !Array.isArray(raw.addresses)) throw new Error('네이버 좌표 응답 형식이 올바르지 않습니다.');
  const matches = raw.addresses.filter((item) => lotAddress(item.jibunAddress) === lotAddress(address));
  const valid = matches.filter((item) => Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.y))
    && ['string', 'number'].includes(typeof item.x) && ['string', 'number'].includes(typeof item.y)
    && String(item.x).trim() !== '' && String(item.y).trim() !== ''
    && item.x !== '' && item.y !== '' && item.x !== null && item.y !== null && item.x !== undefined && item.y !== undefined
    && Number(item.x) >= -180 && Number(item.x) <= 180 && Number(item.y) >= -90 && Number(item.y) <= 90);
  const coordinates = new Set(valid.map((item) => `${Number(item.y)},${Number(item.x)}`));
  if (!matches.length || valid.length !== matches.length || coordinates.size !== 1) {
    return { status: raw.addresses.length ? 'ambiguous' : 'not_found', latitude: null, longitude: null };
  }
  return { status: 'matched', latitude: Number(valid[0].y), longitude: Number(valid[0].x), matchedAddress: valid[0].jibunAddress };
}

export function createNaverGeocoder({ clientId, clientSecret, fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!clientId || !clientSecret) throw new Error('서버의 NAVER_MAPS_CLIENT_ID와 NAVER_MAPS_CLIENT_SECRET을 설정하세요.');
  return async (address) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const url = new URL('https://maps.apigw.ntruss.com/map-geocode/v2/geocode');
      url.search = new URLSearchParams({ query: address, count: '100' }).toString();
      let response;
      try {
        response = await fetchImpl(url, { headers: { Accept: 'application/json', 'x-ncp-apigw-api-key-id': clientId, 'x-ncp-apigw-api-key': clientSecret }, signal: AbortSignal.timeout(10000) });
      } catch (error) {
        if (attempt === 2) throw new Error('네이버 주소 검색에 연결하지 못했습니다.', { cause: error });
        await sleep(1000 * 2 ** attempt); continue;
      }
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 2) { await sleep(1000 * 2 ** attempt); continue; }
      }
      if (!response.ok) throw Object.assign(new Error(`네이버 주소 검색 실패: HTTP ${response.status}`), { status: response.status });
      return selectGeocodingResult(address, await response.json());
    }
  };
}
