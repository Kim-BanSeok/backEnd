import { ok } from '../utils/response.js';
import * as factoriesService from '../services/factories.service.js';

export const list = async (req, res) => ok(res, await factoriesService.listFactories(req.valid.query));
