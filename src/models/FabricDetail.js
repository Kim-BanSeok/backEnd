import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const FabricDetail = sequelize.define('FabricDetail', {
  fabric_detail_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  fabric_id: { type: DataTypes.BIGINT, allowNull: false },
  width_cm: { type: DataTypes.INTEGER, allowNull: false },
  length_cm: { type: DataTypes.INTEGER, allowNull: true },
  material: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'UNKNOWN' },
  thickness: { type: DataTypes.STRING(10), allowNull: false },
  color_family: { type: DataTypes.STRING(10), allowNull: false },
  color_detail: { type: DataTypes.STRING(100), allowNull: true },
  has_defect: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  defect_note: { type: DataTypes.STRING(255), allowNull: true },
  blend_ratio: { type: DataTypes.STRING(100), allowNull: true },
  weave: { type: DataTypes.STRING(50), allowNull: true },
  grain_direction: { type: DataTypes.STRING(50), allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'fabric_details',
});

FabricDetail.associate = function (models) {
  FabricDetail.belongsTo(models.Fabric, { foreignKey: 'fabric_id', as: 'fabric' });
};

export default FabricDetail;
