import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const Favorite = sequelize.define('Favorite', {
  favorite_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.BIGINT, allowNull: false },
  target_type: { type: DataTypes.STRING(10), allowNull: false },
  fabric_id: { type: DataTypes.BIGINT, allowNull: true },
  pattern_id: { type: DataTypes.BIGINT, allowNull: true },
}, {
  tableName: 'favorites',
  updatedAt: false,
});

Favorite.associate = function (models) {
  Favorite.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  Favorite.belongsTo(models.Fabric, { foreignKey: 'fabric_id', as: 'fabric' });
  Favorite.belongsTo(models.Pattern, { foreignKey: 'pattern_id', as: 'pattern' });
};

export default Favorite;
