import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

export default sequelize.define('AiUsageBucket', {
  bucket_key: { type: DataTypes.STRING(96), primaryKey: true },
  window_start: { type: DataTypes.DATE, allowNull: false },
  request_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'ai_usage_buckets', timestamps: false });
