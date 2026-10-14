import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import {
  createInquirySchema,
  listInquiriesSchema,
  listReceivedInquiriesSchema,
  answerInquirySchema,
  updateInquirySchema,
  deleteInquirySchema,
} from '../validators/inquiries.schema.js';
import * as controller from '../controllers/inquiries.controller.js';

const router = Router();

router.post('/fabrics/:fabricId/inquiries', requireAuth('BUYER'), validate(createInquirySchema), controller.create);
router.get('/fabrics/:fabricId/inquiries', optionalAuth, validate(listInquiriesSchema), controller.list);
router.get('/buyers/me/inquiries', requireAuth('BUYER'), validate(listReceivedInquiriesSchema), controller.listMine);
router.get('/sellers/me/inquiries', requireAuth('SELLER'), validate(listReceivedInquiriesSchema), controller.listReceived);
router.post('/inquiries/:inquiryId/answer', requireAuth('SELLER'), validate(answerInquirySchema), controller.answer);
router.patch('/inquiries/:inquiryId', requireAuth('BUYER'), validate(updateInquirySchema), controller.update);
router.delete('/inquiries/:inquiryId', requireAuth('BUYER'), validate(deleteInquirySchema), controller.remove);

export default router;
