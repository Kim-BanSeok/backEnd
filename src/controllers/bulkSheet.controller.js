import { ok } from '../utils/response.js';
import { bulkSheetTemplate, parseBulkSheet } from '../services/bulkSheet.service.js';

export const download = (req, res) => {
  const buffer = bulkSheetTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="fabring-fabrics.xlsx"');
  res.send(Buffer.from(buffer));
};

export const parse = (req, res) => ok(res, parseBulkSheet(req.file.buffer));
