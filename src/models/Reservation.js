import { DataTypes, Op } from 'sequelize';
import sequelize from '../db/connection.js';

const Reservation = sequelize.define('Reservation', {
  reservation_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  fabric_id: { type: DataTypes.BIGINT, allowNull: false },
  buyer_id: { type: DataTypes.BIGINT, allowNull: false },
  seller_id: { type: DataTypes.BIGINT, allowNull: false },
  pattern_id: { type: DataTypes.BIGINT, allowNull: true },
  requested_length_cm: { type: DataTypes.INTEGER, allowNull: true },
  requested_sheet_count: { type: DataTypes.INTEGER, allowNull: true },
  estimated_price: { type: DataTypes.INTEGER, allowNull: true },
  pickup_at: { type: DataTypes.DATE, allowNull: false },
  memo: { type: DataTypes.STRING(500), allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'REQUESTED' },
  reject_reason: { type: DataTypes.STRING(255), allowNull: true },
  canceled_by: { type: DataTypes.STRING(10), allowNull: true },
  accepted_at: { type: DataTypes.DATE, allowNull: true },
  picked_up_at: { type: DataTypes.DATE, allowNull: true },
  canceled_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'reservations',
  indexes: [{
    name: 'reservations_buyer_fabric_active_unique',
    unique: true,
    fields: ['buyer_id', 'fabric_id'],
    where: { status: { [Op.in]: ['REQUESTED', 'ACCEPTED'] } },
  }],
});

Reservation.associate = function (models) {
  Reservation.belongsTo(models.Fabric, { foreignKey: 'fabric_id', as: 'fabric' });
  Reservation.belongsTo(models.User, { foreignKey: 'buyer_id', as: 'buyer' });
  Reservation.belongsTo(models.User, { foreignKey: 'seller_id', as: 'seller' });
  Reservation.belongsTo(models.Pattern, { foreignKey: 'pattern_id', as: 'pattern' });
};

export default Reservation;
