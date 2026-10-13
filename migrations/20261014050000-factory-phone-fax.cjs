'use strict';
const { STRING } = require('sequelize');
// 양주시청 공장등록 엑셀의 전화번호·팩스. 없는 번호는 NULL.

module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn('factories', 'phone_number', { type: STRING(20), allowNull: true });
    await queryInterface.addColumn('factories', 'fax_number', { type: STRING(20), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('factories', 'fax_number');
    await queryInterface.removeColumn('factories', 'phone_number');
  },
};
