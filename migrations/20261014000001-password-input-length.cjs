module.exports = {
  async up(queryInterface, Sequelize) {
    // NULL means the legacy bcrypt input length cannot be established from its hash.
    await queryInterface.addColumn('users', 'password_byte_length', { type: Sequelize.SMALLINT, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'password_byte_length');
  },
};
