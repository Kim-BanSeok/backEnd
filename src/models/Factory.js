import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

// 공공데이터 공장 목록 (임시). 다른 테이블과 관계가 없다.
const Factory = sequelize.define('Factory', {
  factory_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  factory_name: { type: DataTypes.STRING(100), allowNull: false },
  industry: { type: DataTypes.STRING(100), allowNull: true },
  address: { type: DataTypes.STRING(255), allowNull: false },
  phone_number: { type: DataTypes.STRING(20), allowNull: true },
  fax_number: { type: DataTypes.STRING(20), allowNull: true },
  employee_count: { type: DataTypes.INTEGER, allowNull: true },
  legal_dong: { type: DataTypes.STRING(50), allowNull: true },
  latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  data_source: { type: DataTypes.STRING(100), allowNull: false },
}, {
  tableName: 'factories',
  updatedAt: false,
});

export default Factory;
