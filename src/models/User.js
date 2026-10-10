import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const User = sequelize.define('User', {
  user_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  email: { type: DataTypes.STRING(255), allowNull: false },
  password_hash: { type: DataTypes.STRING(255), allowNull: false },
  nickname: { type: DataTypes.STRING(50), allowNull: false },
  phone_number: { type: DataTypes.STRING(20), allowNull: true },
  role: { type: DataTypes.STRING(10), allowNull: false },
  seller_approval_status: { type: DataTypes.STRING(20), allowNull: true },
  privacy_agreed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  terms_agreed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'users',
  paranoid: true, // deleted_at 이 있으면 탈퇴 회원. 조회에서 자동으로 빠진다.
  deletedAt: 'deleted_at',
});

User.associate = function (models) {
  User.hasOne(models.Store, { foreignKey: 'user_id', as: 'store' });
  User.hasMany(models.Reservation, { foreignKey: 'buyer_id', as: 'buyerReservations' });
  User.hasMany(models.Reservation, { foreignKey: 'seller_id', as: 'sellerReservations' });
  User.hasMany(models.Inquiry, { foreignKey: 'buyer_id', as: 'buyerInquiries' });
  User.hasMany(models.Inquiry, { foreignKey: 'seller_id', as: 'sellerInquiries' });
  User.hasMany(models.Favorite, { foreignKey: 'user_id', as: 'favorites' });
};

export default User;
