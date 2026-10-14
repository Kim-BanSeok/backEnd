'use strict';
const { Op } = require('sequelize');

const INDEX = 'reservations_buyer_fabric_active_unique';

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const sql = (text) => queryInterface.sequelize.query(text, { transaction });
      await sql("SET LOCAL lock_timeout = '5s'");
      await sql("SET LOCAL statement_timeout = '60s'");
      // 사전 확인부터 인덱스 생성까지 쓰기를 막아 확인 직후 중복이 들어오는 것도 방지한다.
      await sql('LOCK TABLE reservations IN SHARE MODE');
      const [duplicates] = await sql(`
        SELECT 1 FROM reservations
        WHERE status IN ('REQUESTED', 'ACCEPTED')
        GROUP BY buyer_id, fabric_id HAVING count(*) > 1 LIMIT 1
      `);
      if (duplicates.length > 0) {
        throw new Error('같은 구매자·원단에 활성 예약이 중복되어 인덱스를 적용하지 않았습니다. 기존 예약을 검토한 뒤 다시 적용하세요. 예약 데이터는 변경하지 않았습니다.');
      }
      await queryInterface.addIndex('reservations', ['buyer_id', 'fabric_id'], {
        name: INDEX,
        unique: true,
        where: { status: { [Op.in]: ['REQUESTED', 'ACCEPTED'] } },
        transaction,
      });
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query("SET LOCAL lock_timeout = '5s'", { transaction });
      await queryInterface.sequelize.query("SET LOCAL statement_timeout = '60s'", { transaction });
      await queryInterface.removeIndex('reservations', INDEX, { transaction });
    });
  },
};
