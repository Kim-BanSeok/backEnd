import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createFavoriteSchema, listFavoritesSchema, favoriteIdSchema } from '../validators/favorites.schema.js';
import * as controller from '../controllers/favorites.controller.js';

const router = Router();

router.post('/favorites', requireAuth(), validate(createFavoriteSchema), controller.create);
// /favorites/me 는 /favorites/:favoriteId 보다 먼저 와야 한다. (아니면 "me" 가 favoriteId 로 읽힌다)
router.get('/favorites/me', requireAuth(), validate(listFavoritesSchema), controller.listMine);
router.delete('/favorites/:favoriteId', requireAuth(), validate(favoriteIdSchema), controller.remove);

export default router;
