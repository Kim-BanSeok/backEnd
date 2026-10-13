import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

export default sequelize.define('AiUsageLease', {
  lease_id: { type: DataTypes.STRING(36), primaryKey: true },
  kind: { type: DataTypes.STRING(16), allowNull: false },
  user_id: { type: DataTypes.BIGINT, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'ai_usage_leases', timestamps: false });
