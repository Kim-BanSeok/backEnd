import { ok } from '../utils/response.js';
import * as service from '../services/reservations.service.js';

export const create = async (req, res) => ok(res, await service.createReservation(req.user.userId, req.valid.body), 201);

export const listMine = async (req, res) => ok(res, await service.listMyReservations(req.user.userId, req.valid.query));

export const listReceived = async (req, res) =>
  ok(res, await service.listReceivedReservations(req.user.userId, req.valid.query));

export const getById = async (req, res) =>
  ok(res, await service.getReservation(req.user.userId, req.valid.params.reservationId));

export const accept = async (req, res) =>
  ok(res, await service.acceptReservation(req.user.userId, req.valid.params.reservationId, req.valid.body));

export const reject = async (req, res) =>
  ok(res, await service.rejectReservation(req.user.userId, req.valid.params.reservationId, req.valid.body.reason));

export const cancel = async (req, res) =>
  ok(res, await service.cancelReservation(req.user.userId, req.valid.params.reservationId));

export const pickup = async (req, res) =>
  ok(res, await service.confirmPickup(req.user.userId, req.valid.params.reservationId));
