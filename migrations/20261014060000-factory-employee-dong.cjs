'use strict';
const { INTEGER, STRING } = require('sequelize');
// 양주시청 공장등록 엑셀의 종업원수·법정동. 번호가 없으면 NULL.

module.exports = {
  async up(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await queryInterface.addColumn('factories', 'employee_count', { type: INTEGER, allowNull: true });
    await queryInterface.addColumn('factories', 'legal_dong', { type: STRING(50), allowNull: true });
    await sql('ALTER TABLE factories ADD CONSTRAINT chk_factories_employee_count CHECK (employee_count IS NULL OR employee_count >= 0)');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE factories DROP CONSTRAINT chk_factories_employee_count');
    await queryInterface.removeColumn('factories', 'legal_dong');
    await queryInterface.removeColumn('factories', 'employee_count');
  },
};
