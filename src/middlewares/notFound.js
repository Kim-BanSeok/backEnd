import { fail } from '../utils/errors.js';

export const notFound = (req, res, next) => next(fail('NOT_FOUND'));
