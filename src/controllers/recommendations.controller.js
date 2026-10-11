import { ok } from '../utils/response.js';
import * as recommendationsService from '../services/recommendations.service.js';

export const get = async (req, res) => ok(res, await recommendationsService.getRecommendations(req.valid.params.fabricId));
