import { ok } from '../utils/response.js';
import * as favoritesService from '../services/favorites.service.js';

export const create = async (req, res) =>
  ok(res, await favoritesService.createFavorite(req.user.userId, req.valid.body), 201);

export const listMine = async (req, res) =>
  ok(res, await favoritesService.listMyFavorites(req.user.userId, req.valid.query));

export const remove = async (req, res) =>
  ok(res, await favoritesService.deleteFavorite(req.user.userId, req.valid.params.favoriteId));
