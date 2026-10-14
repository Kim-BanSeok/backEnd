import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

// 공공데이터 공장 목록. 출처 스냅샷과 원본 행을 보존한다.
const Factory = sequelize.define('Factory', {
  factory_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  factory_name: { type: DataTypes.STRING(100), allowNull: false },
  industry: { type: DataTypes.TEXT, allowNull: true },
  address: { type: DataTypes.STRING(255), allowNull: false },
  phone_number: { type: DataTypes.STRING(20), allowNull: true },
  fax_number: { type: DataTypes.STRING(20), allowNull: true },
  employee_count: { type: DataTypes.INTEGER, allowNull: true },
  legal_dong: { type: DataTypes.STRING(50), allowNull: true },
  latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  data_source: { type: DataTypes.STRING(100), allowNull: false },
  source_key: { type: DataTypes.STRING(71), allowNull: true },
  dataset_key: { type: DataTypes.STRING(64), allowNull: true },
  dataset_month: { type: DataTypes.STRING(7), allowNull: true },
  source_record: { type: DataTypes.JSONB, allowNull: true },
  record_hash: { type: DataTypes.STRING(64), allowNull: true },
  supply_status: { type: DataTypes.STRING(16), allowNull: true },
  is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  geocoding_status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'pending' },
  geocoded_address: { type: DataTypes.TEXT, allowNull: true },
  geocoded_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'factories',
  updatedAt: false,
});

export default Factory;
