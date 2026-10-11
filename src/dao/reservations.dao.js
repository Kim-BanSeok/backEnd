import { Op } from 'sequelize';
import db from '../models/index.js';

// 진행 중인 예약(요청됨·수락됨)의 개수. 원단을 삭제해도 되는지 확인할 때 쓴다. options 로 { transaction } 을 받는다.
export const countActiveByFabric = (fabricId, options = {}) =>
  db.Reservation.count({
    where: { fabric_id: fabricId, status: { [Op.in]: ['REQUESTED', 'ACCEPTED'] } },
    ...options,
  });
