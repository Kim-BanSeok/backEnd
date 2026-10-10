import { ok } from '../utils/response.js';
import * as fabricsService from '../services/fabrics.service.js';

export const create = async (req, res) =>
  ok(res, await fabricsService.createFabric(req.user.userId, req.valid.body), 201);
