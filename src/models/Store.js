import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const Store = sequelize.define('Store', {
  store_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  user_id: { type: DataTypes.BIGINT, allowNull: false },
  store_name: { type: DataTypes.STRING(100), allowNull: false },
  store_address: { type: DataTypes.STRING(255), allowNull: false },
  store_phone: { type: DataTypes.STRING(20), allowNull: false },
  closed_days: { type: DataTypes.STRING(100), allowNull: true },
  pickup_guide: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'stores',
});

Store.associate = function (models) {
  Store.belongsTo(models.User, { foreignKey: 'user_id', as: 'seller' });
  Store.hasMany(models.Fabric, { foreignKey: 'store_id', as: 'fabrics' });
};

export default Store;
