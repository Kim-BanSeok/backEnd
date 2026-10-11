import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  createReservationSchema,
  listMyReservationsSchema,
  listReceivedReservationsSchema,
  reservationIdSchema,
  acceptReservationSchema,
  rejectReservationSchema,
} from '../validators/reservations.schema.js';
import * as controller from '../controllers/reservations.controller.js';

const router = Router();

router.post('/reservations', requireAuth('BUYER'), validate(createReservationSchema), controller.create);
// /reservations/me 는 /reservations/:reservationId 보다 먼저 와야 한다. (아니면 "me" 가 예약 번호로 읽힌다)
router.get('/reservations/me', requireAuth('BUYER'), validate(listMyReservationsSchema), controller.listMine);
router.get('/sellers/me/reservations', requireAuth('SELLER'), validate(listReceivedReservationsSchema), controller.listReceived);

// 당사자(예약한 구매자, 그 원단의 판매자)만 볼 수 있다. 역할이 맞아도 내 예약이 아니면 services 가 FORBIDDEN 으로 거절한다.
router.get('/reservations/:reservationId', requireAuth('BUYER', 'SELLER'), validate(reservationIdSchema), controller.getById);
router.post('/reservations/:reservationId/accept', requireAuth('SELLER'), validate(acceptReservationSchema), controller.accept);
router.post('/reservations/:reservationId/reject', requireAuth('SELLER'), validate(rejectReservationSchema), controller.reject);
router.post('/reservations/:reservationId/cancel', requireAuth('BUYER', 'SELLER'), validate(reservationIdSchema), controller.cancel);
router.post('/reservations/:reservationId/pickup', requireAuth('SELLER'), validate(reservationIdSchema), controller.pickup);

export default router;
