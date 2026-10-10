import { ok } from '../utils/response.js';
import * as authService from '../services/auth.service.js';

export const signup = async (req, res) => ok(res, await authService.signup(req.valid.body), 201);

export const login = async (req, res) => ok(res, await authService.login(req.valid.body));
