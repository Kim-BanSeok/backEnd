import { ok } from '../utils/response.js';
import * as patternsService from '../services/patterns.service.js';

export const list = async (req, res) => ok(res, await patternsService.listPatterns(req.valid.query));

export const getById = async (req, res) => ok(res, await patternsService.getPattern(req.valid.params.patternId));
