import { ok } from '../utils/response.js';
import * as storesService from '../services/stores.service.js';

export const create = async (req, res) =>
  ok(res, await storesService.createStore(req.user.userId, req.valid.body), 201);

export const getMine = async (req, res) => ok(res, await storesService.getMyStore(req.user.userId));

export const updateMine = async (req, res) =>
  ok(res, await storesService.updateMyStore(req.user.userId, req.valid.body));

export const getById = async (req, res) => ok(res, await storesService.getStore(req.valid.params.storeId));
