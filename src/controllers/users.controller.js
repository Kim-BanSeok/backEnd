import { ok } from '../utils/response.js';
import * as usersService from '../services/users.service.js';

export const getMe = async (req, res) => ok(res, await usersService.getMe(req.user.userId));

export const updateMe = async (req, res) =>
  ok(res, await usersService.updateMe(req.user.userId, req.valid.body));
