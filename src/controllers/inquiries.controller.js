import { ok } from '../utils/response.js';
import * as inquiriesService from '../services/inquiries.service.js';

export const create = async (req, res) =>
  ok(res, await inquiriesService.createInquiry(req.user.userId, req.valid.params.fabricId, req.valid.body), 201);

export const list = async (req, res) =>
  ok(res, await inquiriesService.listFabricInquiries(req.user, req.valid.params.fabricId, req.valid.query));

export const listReceived = async (req, res) =>
  ok(res, await inquiriesService.listReceivedInquiries(req.user.userId, req.valid.query));

export const answer = async (req, res) =>
  ok(res, await inquiriesService.answerInquiry(req.user.userId, req.valid.params.inquiryId, req.valid.body));
