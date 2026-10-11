import { ok } from '../utils/response.js';
import * as fabricsService from '../services/fabrics.service.js';

export const create = async (req, res) =>
  ok(res, await fabricsService.createFabric(req.user.userId, req.valid.body), 201);

export const update = async (req, res) =>
  ok(res, await fabricsService.updateFabric(req.user.userId, req.valid.params.fabricId, req.valid.body));

export const remove = async (req, res) =>
  ok(res, await fabricsService.deleteFabric(req.user.userId, req.valid.params.fabricId));
