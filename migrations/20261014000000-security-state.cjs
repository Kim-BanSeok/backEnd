module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable('revoked_tokens', {
        token_hash: { type: Sequelize.STRING(64), primaryKey: true },
        expires_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('revoked_tokens', ['expires_at'], { transaction });
      await queryInterface.createTable('ai_usage_buckets', {
        bucket_key: { type: Sequelize.STRING(96), primaryKey: true },
        window_start: { type: Sequelize.DATE, allowNull: false },
        request_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      }, { transaction });
      await queryInterface.createTable('ai_usage_leases', {
        lease_id: { type: Sequelize.STRING(36), primaryKey: true },
        kind: { type: Sequelize.STRING(16), allowNull: false },
        user_id: { type: Sequelize.BIGINT, allowNull: false },
        expires_at: { type: Sequelize.DATE, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('ai_usage_leases', ['kind', 'expires_at'], { transaction });
      await queryInterface.addIndex('ai_usage_leases', ['kind', 'user_id', 'expires_at'], { transaction });
      await queryInterface.createTable('ai_sessions', {
        session_id: { type: Sequelize.STRING(24), primaryKey: true },
        seller_id: { type: Sequelize.BIGINT, allowNull: false },
        session_status: { type: Sequelize.STRING(16), allowNull: false },
        last_updated_at: { type: Sequelize.DATE, allowNull: false },
        payload: { type: Sequelize.JSONB, allowNull: false },
      }, { transaction });
      await queryInterface.addIndex('ai_sessions', ['last_updated_at'], { transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.dropTable('ai_sessions', { transaction });
      await queryInterface.dropTable('ai_usage_leases', { transaction });
      await queryInterface.dropTable('ai_usage_buckets', { transaction });
      await queryInterface.dropTable('revoked_tokens', { transaction });
    });
  },
};
