import { ok } from '../utils/response.js';
import * as fabricsReadService from '../services/fabricsRead.service.js';

export const list = async (req, res) => ok(res, await fabricsReadService.listFabrics(req.valid.query));

export const getById = async (req, res) =>
  ok(res, await fabricsReadService.getFabric(req.user, req.valid.params.fabricId));

export const listMine = async (req, res) =>
  ok(res, await fabricsReadService.listMyFabrics(req.user.userId, req.valid.query));
