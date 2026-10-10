import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const Inquiry = sequelize.define('Inquiry', {
  inquiry_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  fabric_id: { type: DataTypes.BIGINT, allowNull: false },
  buyer_id: { type: DataTypes.BIGINT, allowNull: false },
  seller_id: { type: DataTypes.BIGINT, allowNull: false },
  content: { type: DataTypes.STRING(1000), allowNull: false },
  is_private: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'WAITING' },
  answer: { type: DataTypes.STRING(1000), allowNull: true },
  answered_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'inquiries',
  paranoid: true,
  deletedAt: 'deleted_at',
});

Inquiry.associate = function (models) {
  Inquiry.belongsTo(models.Fabric, { foreignKey: 'fabric_id', as: 'fabric' });
  Inquiry.belongsTo(models.User, { foreignKey: 'buyer_id', as: 'buyer' });
  Inquiry.belongsTo(models.User, { foreignKey: 'seller_id', as: 'seller' });
};

export default Inquiry;
