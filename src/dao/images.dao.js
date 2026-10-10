import db from '../models/index.js';

// options 로 { transaction } 을 받는다. 없으면 null 을 돌려준다.
export const countByFabric = (fabricId, options = {}) =>
  db.FabricImage.count({ where: { fabric_id: fabricId }, ...options });

export const listByFabric = (fabricId, options = {}) =>
  db.FabricImage.findAll({ where: { fabric_id: fabricId }, order: [['sort_order', 'ASC']], ...options });

// 다른 원단의 사진 번호로는 찾을 수 없게 fabric_id 도 함께 조건으로 쓴다.
export const findOne = (fabricId, imageId, options = {}) =>
  db.FabricImage.findOne({ where: { fabric_id: fabricId, image_id: imageId }, ...options });

export const insert = (values, options = {}) => db.FabricImage.create(values, options);

export const destroy = (image, options = {}) => image.destroy(options);

export const updateSortOrder = (image, sortOrder, options = {}) => image.update({ sort_order: sortOrder }, options);
