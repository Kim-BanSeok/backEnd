import { ok } from '../utils/response.js';
import * as imagesService from '../services/images.service.js';

export const upload = async (req, res) =>
  ok(
    res,
    await imagesService.addImage(req.user.userId, req.valid.params.fabricId, {
      buffer: req.file.buffer,
      imageType: req.valid.body.image_type,
    }),
    201,
  );

export const remove = async (req, res) => {
  const { fabricId, imageId } = req.valid.params;
  ok(res, await imagesService.removeImage(req.user.userId, fabricId, imageId));
};
