import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';
export default sequelize.define('AiSession', {
  session_id: { type: DataTypes.STRING(24), primaryKey: true },
  seller_id: { type: DataTypes.BIGINT, allowNull: false },
  session_status: { type: DataTypes.STRING(16), allowNull: false },
  last_updated_at: { type: DataTypes.DATE, allowNull: false },
  payload: { type: DataTypes.JSONB, allowNull: false },
}, { tableName: 'ai_sessions', timestamps: false });
