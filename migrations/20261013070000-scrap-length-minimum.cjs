'use strict';
// 자투리 세로 길이는 30~90cm 가 아니라 1cm 이상의 정수다.

module.exports = {
  async up(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE fabric_details DROP CONSTRAINT chk_details_length');
    await sql('ALTER TABLE fabric_details ADD CONSTRAINT chk_details_length CHECK (length_cm IS NULL OR length_cm >= 1)');
  },

  async down(queryInterface) {
    const sql = (text) => queryInterface.sequelize.query(text);
    await sql('ALTER TABLE fabric_details DROP CONSTRAINT chk_details_length');
    await sql('ALTER TABLE fabric_details ADD CONSTRAINT chk_details_length CHECK (length_cm IS NULL OR length_cm BETWEEN 30 AND 90)');
  },
};
