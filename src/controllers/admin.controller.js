import { ok } from '../utils/response.js';
import * as adminService from '../services/admin.service.js';

export const listFabrics = async (req, res) => ok(res, await adminService.listFabrics(req.valid.query));

export const approveFabric = async (req, res) =>
  ok(res, await adminService.approveFabric(req.valid.params.fabricId));

export const rejectFabric = async (req, res) =>
  ok(res, await adminService.rejectFabric(req.valid.params.fabricId, req.valid.body.reason));

export const listSellers = async (req, res) => ok(res, await adminService.listSellers(req.valid.query));

export const approveSeller = async (req, res) =>
  ok(res, await adminService.approveSeller(req.valid.params.userId));

export const rejectSeller = async (req, res) =>
  ok(res, await adminService.rejectSeller(req.valid.params.userId));
