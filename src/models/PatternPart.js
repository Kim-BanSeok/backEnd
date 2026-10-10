import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const PatternPart = sequelize.define('PatternPart', {
  part_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  pattern_id: { type: DataTypes.BIGINT, allowNull: false },
  part_name: { type: DataTypes.STRING(50), allowNull: false },
  width_cm: { type: DataTypes.INTEGER, allowNull: false },
  height_cm: { type: DataTypes.INTEGER, allowNull: false },
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
  tableName: 'pattern_parts',
  timestamps: false, // created_at, updated_at 모두 없다.
});

PatternPart.associate = function (models) {
  PatternPart.belongsTo(models.Pattern, { foreignKey: 'pattern_id', as: 'pattern', onDelete: 'CASCADE' });
};

export default PatternPart;
