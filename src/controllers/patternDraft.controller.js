import { ok } from '../utils/response.js';
import * as service from '../services/patternDraft.service.js';

export const create = async (req, res) => ok(res, await service.createPatternDraft(req.valid.body), 201);
