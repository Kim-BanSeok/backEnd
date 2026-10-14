'use strict';
const { INTEGER } = require('sequelize');
// 자투리 예약은 고른 장수만 확보하고 수령 때 그 장수만 줄인다.

module.exports = {
  async up(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await queryInterface.addColumn('fabrics', 'reserved_sheet_count', {
      type: INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('reservations', 'requested_sheet_count', {
      type: INTEGER,
      allowNull: true,
    });
    await sql('ALTER TABLE fabrics ADD CONSTRAINT chk_fabrics_reserved_sheet_count CHECK (reserved_sheet_count >= 0)');
    await sql('ALTER TABLE reservations ADD CONSTRAINT chk_reservations_requested_sheet_count CHECK (requested_sheet_count IS NULL OR requested_sheet_count >= 1)');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE reservations DROP CONSTRAINT chk_reservations_requested_sheet_count');
    await sql('ALTER TABLE fabrics DROP CONSTRAINT chk_fabrics_reserved_sheet_count');
    await queryInterface.removeColumn('reservations', 'requested_sheet_count');
    await queryInterface.removeColumn('fabrics', 'reserved_sheet_count');
  },
};
