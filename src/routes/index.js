import { Router } from 'express';
import health from './health.routes.js';
import auth from './auth.routes.js';
import users from './users.routes.js';
import stores from './stores.routes.js';
import fabrics from './fabrics.routes.js';
import fabricsRead from './fabricsRead.routes.js';
import images from './images.routes.js';
import patterns from './patterns.routes.js';
import factories from './factories.routes.js';
import favorites from './favorites.routes.js';
import admin from './admin.routes.js';
import inquiries from './inquiries.routes.js';
import reservations from './reservations.routes.js';
import recommendations from './recommendations.routes.js';
import aiSessions from './aiSessions.routes.js';
import patternDraft from './patternDraft.routes.js';
import bulkSheet from './bulkSheet.routes.js';

const router = Router();

// 새 API 파일을 만들면 여기에 한 줄 추가한다.
router.use(health);
router.use(auth);
router.use(users);
router.use(stores);
router.use(fabrics);
router.use(fabricsRead);
router.use(images);
router.use(patterns);
router.use(factories);
router.use(favorites);
router.use(admin);
router.use(inquiries);
router.use(reservations);
router.use(recommendations);
router.use(aiSessions);
router.use(patternDraft);
router.use(bulkSheet);

export default router;
