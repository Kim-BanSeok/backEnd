import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const FabricImage = sequelize.define('FabricImage', {
  image_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  fabric_id: { type: DataTypes.BIGINT, allowNull: false },
  image_url: { type: DataTypes.STRING(500), allowNull: false },
  thumbnail_url: { type: DataTypes.STRING(500), allowNull: true },
  image_type: { type: DataTypes.STRING(10), allowNull: true },
  sort_order: { type: DataTypes.SMALLINT, allowNull: false, defaultValue: 0 },
}, {
  tableName: 'fabric_images',
  updatedAt: false, // updated_at 컬럼이 없다.
});

FabricImage.associate = function (models) {
  FabricImage.belongsTo(models.Fabric, { foreignKey: 'fabric_id', as: 'fabric' });
};

export default FabricImage;
