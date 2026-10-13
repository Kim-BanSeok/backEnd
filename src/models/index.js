import sequelize from '../db/connection.js';
import User from './User.js';
import Store from './Store.js';
import Fabric from './Fabric.js';
import FabricDetail from './FabricDetail.js';
import FabricImage from './FabricImage.js';
import Reservation from './Reservation.js';
import Pattern from './Pattern.js';
import PatternPart from './PatternPart.js';
import Favorite from './Favorite.js';
import Inquiry from './Inquiry.js';
import Factory from './Factory.js';
import FactoryDataset from './FactoryDataset.js';
import RevokedToken from './RevokedToken.js';
import AiUsageBucket from './AiUsageBucket.js';
import AiUsageLease from './AiUsageLease.js';
import AiSession from './AiSession.js';

const db = {
  sequelize,
  User,
  Store,
  Fabric,
  FabricDetail,
  FabricImage,
  Reservation,
  Pattern,
  PatternPart,
  Favorite,
  Inquiry,
  Factory,
  FactoryDataset,
  RevokedToken,
  AiUsageBucket,
  AiUsageLease,
  AiSession,
};

// 모델 간 관계 설정
Object.values(db).forEach((model) => {
  if (model.associate) model.associate(db);
});

export default db;
