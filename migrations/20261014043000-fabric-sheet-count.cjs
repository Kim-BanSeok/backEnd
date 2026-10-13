'use strict';
const { INTEGER } = require('sequelize');
// 자투리 판매 장수. 롤은 NULL, 이미 있는 자투리는 1장으로 채운다.

module.exports = {
  async up(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await queryInterface.addColumn('fabric_details', 'sheet_count', {
      type: INTEGER,
      allowNull: true,
    });
    await sql(`UPDATE fabric_details AS detail
      SET sheet_count = 1
      FROM fabrics
      WHERE fabrics.fabric_id = detail.fabric_id AND fabrics.sale_type = 'SCRAP' AND detail.sheet_count IS NULL`);
    await sql('ALTER TABLE fabric_details ADD CONSTRAINT chk_details_sheet_count CHECK (sheet_count IS NULL OR sheet_count >= 1)');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE fabric_details DROP CONSTRAINT chk_details_sheet_count');
    await queryInterface.removeColumn('fabric_details', 'sheet_count');
  },
};
