import { toKstIso } from '../utils/response.js';
import { classifyIndustry } from '../factories/categories.js';
import * as factoriesDao from '../dao/factories.dao.js';

const coord = (value) => (value === null || value === undefined ? null : Number(value));

// 공장 목록 항목. 생산품(industry)은 원문, category 는 그 문장을 묶은 코드.
export const toFactoryResponse = (factory) => ({
  factoryId: Number(factory.factory_id),
  factory_name: factory.factory_name,
  industry: factory.industry,
  category: classifyIndustry(factory.industry),
  address: factory.address,
  latitude: coord(factory.latitude),
  longitude: coord(factory.longitude),
  data_source: factory.data_source,
  created_at: toKstIso(factory.created_at),
});

// category 가 있으면 그 업종만. 페이지는 묶은 뒤의 목록 기준이다.
export async function listFactories({ category, page, size }) {
  const matched = (await factoriesDao.findAll())
    .map(toFactoryResponse)
    .filter((row) => !category || row.category === category);
  return {
    content: matched.slice(page * size, page * size + size),
    page,
    size,
    totalElements: matched.length,
    totalPages: Math.ceil(matched.length / size),
  };
}
