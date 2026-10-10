import pg from 'pg';
import { Sequelize } from 'sequelize';
import { env } from '../config/env.js';

// BIGINT(id)를 문자열이 아닌 숫자로 받는다. (id 는 Number.MAX_SAFE_INTEGER 를 넘지 않는다고 본다)
pg.defaults.parseInt8 = true;

const { database, username, password, host, port, dialect } = env.db;

const sequelize = new Sequelize(database, username, password, {
  host,
  port,
  dialect,
  logging: false,
  // DB 에는 TIMESTAMPTZ 로 저장하고, 한국 시간(+09:00) 변환은 응답을 만들 때 한다.
  timezone: '+00:00',
  define: {
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: false,
  },
});

export default sequelize;
