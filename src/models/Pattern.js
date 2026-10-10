import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const Pattern = sequelize.define('Pattern', {
  pattern_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  pattern_name: { type: DataTypes.STRING(100), allowNull: false },
  aliases: { type: DataTypes.STRING(255), allowNull: true },
  category: { type: DataTypes.STRING(50), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  image_url: { type: DataTypes.STRING(500), allowNull: true },
  allowed_materials: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false },
  allowed_thickness: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false },
  reviewed_by: { type: DataTypes.STRING(50), allowNull: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, {
  tableName: 'patterns',
});

Pattern.associate = function (models) {
  Pattern.hasMany(models.PatternPart, { foreignKey: 'pattern_id', as: 'parts', onDelete: 'CASCADE' });
  Pattern.hasMany(models.Reservation, { foreignKey: 'pattern_id', as: 'reservations' });
  Pattern.hasMany(models.Favorite, { foreignKey: 'pattern_id', as: 'favorites' });
};

export default Pattern;
