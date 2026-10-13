// 원본 생산품·중복 행과 월별 적재 기록을 보존한다. 기존 초기 마이그레이션은 그대로 둔다.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.changeColumn('factories', 'industry', { type: Sequelize.TEXT, allowNull: true }, { transaction });
      await queryInterface.createTable('factory_datasets', {
        dataset_key: { type: Sequelize.STRING(64), primaryKey: true },
        dataset_month: { type: Sequelize.STRING(7), allowNull: false },
        source_manifest: { type: Sequelize.JSONB, allowNull: false },
        prepared_records: { type: Sequelize.JSONB, allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      }, { transaction });
      const columns = {
        source_key: { type: Sequelize.STRING(71), allowNull: true },
        dataset_key: { type: Sequelize.STRING(64), allowNull: true, references: { model: 'factory_datasets', key: 'dataset_key' } },
        dataset_month: { type: Sequelize.STRING(7), allowNull: true },
        source_record: { type: Sequelize.JSONB, allowNull: true },
        record_hash: { type: Sequelize.STRING(64), allowNull: true },
        supply_status: { type: Sequelize.STRING(16), allowNull: true },
        is_current: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        geocoding_status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'pending' },
        geocoded_address: { type: Sequelize.TEXT, allowNull: true },
        geocoded_at: { type: Sequelize.DATE, allowNull: true },
      };
      for (const [name, definition] of Object.entries(columns)) await queryInterface.addColumn('factories', name, definition, { transaction });
      await queryInterface.addIndex('factories', ['source_key'], { unique: true, name: 'factories_source_key_unique', transaction });
      await queryInterface.addIndex('factories', ['is_current', 'supply_status'], { name: 'factories_current_supply_index', transaction });
      await queryInterface.addIndex('factory_datasets', ['dataset_month'], { name: 'factory_datasets_month_index', transaction });
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      const [rows] = await queryInterface.sequelize.query('SELECT COUNT(*)::int AS count FROM factories WHERE length(industry) > 100', { transaction });
      if (rows[0].count) throw new Error('100자를 넘는 생산품 원문이 있어 이전 스키마로 되돌릴 수 없습니다. 먼저 원본을 보존하고 데이터를 처리하세요.');
      await queryInterface.removeIndex('factories', 'factories_current_supply_index', { transaction });
      await queryInterface.removeIndex('factories', 'factories_source_key_unique', { transaction });
      for (const name of ['geocoded_at', 'geocoded_address', 'geocoding_status', 'is_current', 'supply_status', 'record_hash', 'source_record', 'dataset_month', 'dataset_key', 'source_key']) {
        await queryInterface.removeColumn('factories', name, { transaction });
      }
      await queryInterface.dropTable('factory_datasets', { transaction });
      await queryInterface.changeColumn('factories', 'industry', { type: Sequelize.STRING(100), allowNull: true }, { transaction });
    });
  },
};
