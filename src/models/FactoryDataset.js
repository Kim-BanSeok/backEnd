import { DataTypes } from 'sequelize';
import sequelize from '../db/connection.js';

const FactoryDataset = sequelize.define('FactoryDataset', {
  dataset_key: { type: DataTypes.STRING(64), primaryKey: true },
  dataset_month: { type: DataTypes.STRING(7), allowNull: false },
  source_manifest: { type: DataTypes.JSONB, allowNull: false },
  prepared_records: { type: DataTypes.JSONB, allowNull: false },
}, { tableName: 'factory_datasets', updatedAt: false });

export default FactoryDataset;
