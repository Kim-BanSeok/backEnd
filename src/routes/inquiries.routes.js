import { Router } from 'express';
import { optionalAuth, requireAuth } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { createInquirySchema, listInquiriesSchema } from '../validators/inquiries.schema.js';
import * as controller from '../controllers/inquiries.controller.js';

const router = Router();

router.post('/fabrics/:fabricId/inquiries', requireAuth('BUYER'), validate(createInquirySchema), controller.create);
router.get('/fabrics/:fabricId/inquiries', optionalAuth, validate(listInquiriesSchema), controller.list);

export default router;
