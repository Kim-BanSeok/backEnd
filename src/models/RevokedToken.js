import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

export default sequelize.define('RevokedToken', {
  token_hash: { type: DataTypes.STRING(64), primaryKey: true },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'revoked_tokens', timestamps: false });
