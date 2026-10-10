import { Router } from 'express';
import health from './health.routes.js';
import auth from './auth.routes.js';
import users from './users.routes.js';
import stores from './stores.routes.js';

const router = Router();

// 새 API 파일을 만들면 여기에 한 줄 추가한다.
router.use(health);
router.use(auth);
router.use(users);
router.use(stores);

export default router;
