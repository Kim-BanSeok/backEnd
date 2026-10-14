import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const Fabric = sequelize.define('Fabric', {
  fabric_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  store_id: { type: DataTypes.BIGINT, allowNull: false },
  title: { type: DataTypes.STRING(100), allowNull: false },
  sale_type: { type: DataTypes.STRING(10), allowNull: false },
  price: { type: DataTypes.INTEGER, allowNull: false },
  remaining_length_cm: { type: DataTypes.INTEGER, allowNull: true },
  reserved_length_cm: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  reserved_sheet_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING' },
  reject_reason: { type: DataTypes.STRING(255), allowNull: true },
}, {
  tableName: 'fabrics',
  paranoid: true,
  deletedAt: 'deleted_at',
});

Fabric.associate = function (models) {
  Fabric.belongsTo(models.Store, { foreignKey: 'store_id', as: 'store' });
  Fabric.hasOne(models.FabricDetail, { foreignKey: 'fabric_id', as: 'detail' });
  Fabric.hasMany(models.FabricImage, { foreignKey: 'fabric_id', as: 'images' });
  Fabric.hasMany(models.Reservation, { foreignKey: 'fabric_id', as: 'reservations' });
  Fabric.hasMany(models.Inquiry, { foreignKey: 'fabric_id', as: 'inquiries' });
  Fabric.hasMany(models.Favorite, { foreignKey: 'fabric_id', as: 'favorites' });
};

export default Fabric;
