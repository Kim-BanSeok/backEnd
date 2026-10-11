import { ok } from '../utils/response.js';
import * as service from '../services/aiRegistration.service.js';

export const start = async (req, res) => ok(res, await service.startSession(req.user.userId), 201);

export const getById = async (req, res) => ok(res, await service.getSession(req.user.userId, req.valid.params.sessionId));

export const answer = async (req, res) =>
  ok(res, await service.answerSession(req.user.userId, req.valid.params.sessionId, req.valid.body));

export const confirm = async (req, res) =>
  ok(res, await service.confirmSession(req.user.userId, req.valid.params.sessionId, req.valid.body), 201);

export const abort = async (req, res) => ok(res, await service.abortSession(req.user.userId, req.valid.params.sessionId));
