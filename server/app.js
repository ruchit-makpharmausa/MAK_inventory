import cors from 'cors';
import express from 'express';
import sql from 'mssql';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import database, { connectionFailure } from './database.js';
import { mountAuthentication } from './auth.js';
import { mountUserAdministration } from './users.js';

const productSelect = `
  SELECT p.id, p.product_type_id AS productTypeId, pt.name AS productType,
         p.name, p.item_code AS itemCode, p.mak_item_code AS makItemCode, p.unit, p.comment,
         COALESCE(r.total_received, 0) AS totalReceived,
         COALESCE(u.total_used, 0) AS totalUsed,
         COALESCE(r.total_received, 0) - COALESCE(u.total_used, 0) AS availableBalance
  FROM dbo.products p JOIN dbo.product_types pt ON pt.id = p.product_type_id
  LEFT JOIN (SELECT product_id, SUM(quantity) AS total_received FROM dbo.receiving_transactions GROUP BY product_id) r ON r.product_id = p.id
  LEFT JOIN (SELECT product_id, SUM(quantity) AS total_used FROM dbo.usage_transactions GROUP BY product_id) u ON u.product_id = p.id
`;
const requiredText = (value) => typeof value === 'string' && value.trim().length > 0;
const optionalText = (value) => value == null || typeof value === 'string';
const validId = (value) => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647;
const tooLong = (value, length) => typeof value === 'string' && value.trim().length > length;
const duplicate = (error) => [2601, 2627].includes(error.number);
function productError(body) {
  if (!requiredText(body.name) || !requiredText(body.itemCode) || !requiredText(body.unit)) return 'Product name, item code, and unit are required.';
  if (!validId(body.productTypeId)) return 'Select a valid product type.';
  if (!optionalText(body.makItemCode) || !optionalText(body.comment)) return 'MAK item code and comment must be text.';
  if (tooLong(body.itemCode, 255) || tooLong(body.makItemCode, 255)) return 'Item codes must be 255 characters or fewer.';
  if (tooLong(body.unit, 50)) return 'Unit must be 50 characters or fewer.';
  return null;
}
function productInputs(body) {
  return {
    productTypeId: [sql.Int, Number(body.productTypeId)], name: [sql.NVarChar(sql.MAX), body.name.trim()],
    itemCode: [sql.NVarChar(255), body.itemCode.trim()], makItemCode: [sql.NVarChar(255), body.makItemCode?.trim() || ''],
    unit: [sql.NVarChar(50), body.unit.trim()], comment: [sql.NVarChar(sql.MAX), body.comment?.trim() || ''],
  };
}
function transactionError(body, kind) {
  if (!validId(body.productId)) return 'Select a valid product.';
  const date = body[kind === 'receiving' ? 'receivingDate' : 'usageDate'];
  if (!requiredText(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return 'Enter a valid transaction date.';
  if (typeof body.quantity !== 'number' || !Number.isFinite(body.quantity) || body.quantity <= 0) return 'Quantity must be greater than zero.';
  if (kind === 'usage' && !requiredText(body.makLotNumber)) return 'MAK lot number is required.';
  if (!optionalText(body.materialLotNumber) || !optionalText(body.remarks)) return 'Material lot number and remarks must be text.';
  if (kind === 'receiving' && !optionalText(body.makReleaseNumber)) return 'MAK Release Number must be text.';
  if (tooLong(body.materialLotNumber, 255) || tooLong(body.makLotNumber, 255)) return 'Lot numbers must be 255 characters or fewer.';
  if (kind === 'receiving' && tooLong(body.makReleaseNumber, 255)) return 'MAK Release Number must be 255 characters or fewer.';
  return null;
}
function transactionInputs(body, kind) {
  return {
    productId: [sql.Int, Number(body.productId)],
    date: [sql.Date, new Date(`${body[kind === 'receiving' ? 'receivingDate' : 'usageDate']}T00:00:00Z`)],
    quantity: [sql.Float, body.quantity], materialLotNumber: [sql.NVarChar(255), body.materialLotNumber?.trim() || null],
    remarks: [sql.NVarChar(sql.MAX), body.remarks?.trim() || null],
    ...(kind === 'usage' ? { makLotNumber: [sql.NVarChar(255), body.makLotNumber.trim()] }
      : { makReleaseNumber: [sql.NVarChar(255), body.makReleaseNumber?.trim() || null] }),
  };
}

export function createApp(db = database, {
  serveClient = true,
  clientDirectory = fileURLToPath(new URL('../dist/', import.meta.url)),
} = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const fail = (res, status, message) => res.status(status).json({ error: message });
  const getProduct = async (id, executor) => {
    const result = await db.query(`${productSelect} WHERE p.id = @id`, { id: [sql.Int, Number(id)] }, executor);
    return result.recordset[0];
  };
  const lockProduct = async (productId, executor) => {
    const result = await db.query('SELECT id FROM dbo.products WITH (UPDLOCK, HOLDLOCK) WHERE id = @productId', { productId: [sql.Int, Number(productId)] }, executor);
    return result.recordset.length > 0;
  };

  app.get('/api/health', route(async (_req, res) => {
    await db.getPool();
    await db.query('SELECT TOP (0) id FROM dbo.products');
    res.json({ status: 'ok', database: 'sqlserver' });
  }));
  mountAuthentication(app, db);
  mountUserAdministration(app, db);

  app.get('/api/product-types', route(async (_req, res) => {
    res.json((await db.query('SELECT id, name FROM dbo.product_types ORDER BY name')).recordset);
  }));
  app.post('/api/product-types', route(async (req, res) => {
    if (!requiredText(req.body.name)) return fail(res, 400, 'Product type name is required.');
    if (tooLong(req.body.name, 255)) return fail(res, 400, 'Product type name must be 255 characters or fewer.');
    try {
      const result = await db.query(`
        INSERT INTO dbo.product_types (name, created_at) VALUES (@name, SYSUTCDATETIME());
        SELECT id, name FROM dbo.product_types WHERE id = CAST(SCOPE_IDENTITY() AS int);
      `, { name: [sql.NVarChar(255), req.body.name.trim()] });
      res.status(201).json(result.recordset[0]);
    } catch (error) {
      if (duplicate(error)) return fail(res, 409, 'That product type already exists.');
      throw error;
    }
  }));
  app.get('/api/products', route(async (req, res) => {
    const search = String(req.query.search || '').trim();
    const typeId = req.query.typeId ? Number(req.query.typeId) : null;
    if (typeId !== null && !validId(typeId)) return fail(res, 400, 'Select a valid product type.');
    const result = await db.query(`
      ${productSelect}
      WHERE (@search = N'' OR p.name LIKE N'%' + @search + N'%'
             OR p.item_code LIKE N'%' + @search + N'%' OR p.mak_item_code LIKE N'%' + @search + N'%')
        AND (@typeId IS NULL OR p.product_type_id = @typeId)
      ORDER BY p.name
    `, { search: [sql.NVarChar(sql.MAX), search], typeId: [sql.Int, typeId] });
    res.json(result.recordset);
  }));
  app.post('/api/products', route(async (req, res) => {
    const errorMessage = productError(req.body);
    if (errorMessage) return fail(res, 400, errorMessage);
    try {
      const result = await db.query(`
        INSERT INTO dbo.products (product_type_id, name, item_code, mak_item_code, unit, comment, created_at, updated_at)
        VALUES (@productTypeId, @name, @itemCode, @makItemCode, @unit, @comment, SYSUTCDATETIME(), SYSUTCDATETIME());
        SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
      `, productInputs(req.body));
      res.status(201).json(await getProduct(result.recordset[0].id));
    } catch (error) {
      if (duplicate(error)) return fail(res, 409, 'That item code already exists for the selected product type.');
      if (error.number === 547) return fail(res, 400, 'Select a valid product type.');
      throw error;
    }
  }));
  app.put('/api/products/:id', route(async (req, res) => {
    const errorMessage = productError(req.body);
    if (errorMessage) return fail(res, 400, errorMessage);
    if (!validId(req.params.id)) return fail(res, 404, 'Product not found.');
    try {
      const result = await db.query(`
        UPDATE dbo.products SET product_type_id = @productTypeId, name = @name, item_code = @itemCode,
          mak_item_code = @makItemCode, unit = @unit, comment = @comment, updated_at = SYSUTCDATETIME()
        WHERE id = @id;
        SELECT @@ROWCOUNT AS matched;
      `, { ...productInputs(req.body), id: [sql.Int, Number(req.params.id)] });
      if (!result.recordset[0].matched) return fail(res, 404, 'Product not found.');
      res.json(await getProduct(req.params.id));
    } catch (error) {
      if (duplicate(error)) return fail(res, 409, 'That item code already exists for the selected product type.');
      if (error.number === 547) return fail(res, 400, 'Select a valid product type.');
      throw error;
    }
  }));
  app.get('/api/transactions/:kind', route(async (req, res) => {
    const { kind } = req.params;
    if (!['receiving', 'usage'].includes(kind)) return fail(res, 404, 'Transaction type not found.');
    const table = kind === 'receiving' ? 'receiving_transactions' : 'usage_transactions';
    const dateColumn = kind === 'receiving' ? 'receiving_date' : 'usage_date';
    const result = await db.query(`
      SELECT t.id, t.product_id AS productId, CONVERT(char(10), t.${dateColumn}, 23) AS [date],
             t.quantity, t.material_lot_number AS materialLotNumber,
             ${kind === 'usage' ? 't.mak_lot_number AS makLotNumber,' : 't.mak_release_number AS makReleaseNumber,'}
             t.remarks, p.name AS productName, p.item_code AS itemCode, pt.name AS productType, p.unit
      FROM dbo.${table} t JOIN dbo.products p ON p.id = t.product_id
      JOIN dbo.product_types pt ON pt.id = p.product_type_id
      ORDER BY t.${dateColumn} DESC, t.id DESC
    `);
    res.json(result.recordset);
  }));
  app.post('/api/transactions/receiving', route(async (req, res) => {
    // Preserve submissions from forms cached before the release-number rename.
    const { makRnNumber, ...body } = req.body;
    if (!Object.hasOwn(body, 'makReleaseNumber')) body.makReleaseNumber = makRnNumber;
    const errorMessage = transactionError(body, 'receiving');
    if (errorMessage) return fail(res, 400, errorMessage);
    const result = await db.transaction(async (executor) => {
      if (!await lockProduct(body.productId, executor)) return { status: 404, error: 'Product not found.' };
      const inserted = await db.query(`
        INSERT INTO dbo.receiving_transactions (product_id, receiving_date, quantity, material_lot_number, mak_release_number, remarks, created_at)
        VALUES (@productId, @date, @quantity, @materialLotNumber, @makReleaseNumber, @remarks, SYSUTCDATETIME());
        SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
      `, transactionInputs(body, 'receiving'), executor);
      return { id: inserted.recordset[0].id };
    });
    if (result.error) return fail(res, result.status, result.error);
    res.status(201).json({ ...body, makReleaseNumber: body.makReleaseNumber?.trim() || null, id: result.id });
  }));
  app.post('/api/transactions/usage', route(async (req, res) => {
    const errorMessage = transactionError(req.body, 'usage');
    if (errorMessage) return fail(res, 400, errorMessage);
    const result = await db.transaction(async (executor) => {
      if (!await lockProduct(req.body.productId, executor)) return { status: 404, error: 'Product not found.' };
      const product = await getProduct(req.body.productId, executor);
      const inputs = transactionInputs(req.body, 'usage');
      const balance = Number(product.availableBalance);
      if (req.body.quantity > balance) {
        return { status: 400, error: `Insufficient inventory. Available: ${balance} ${product.unit}.` };
      }
      const inserted = await db.query(`
        INSERT INTO dbo.usage_transactions (product_id, usage_date, quantity, material_lot_number, mak_lot_number, remarks, created_at)
        VALUES (@productId, @date, @quantity, @materialLotNumber, @makLotNumber, @remarks, SYSUTCDATETIME());
        SELECT CAST(SCOPE_IDENTITY() AS int) AS id;
      `, inputs, executor);
      return { status: 201, id: inserted.recordset[0].id, product: await getProduct(req.body.productId, executor) };
    });
    if (result.error) return fail(res, result.status, result.error);
    res.status(201).json(result);
  }));
  app.get('/api/products/:id/history', route(async (req, res) => {
    if (!validId(req.params.id)) return fail(res, 404, 'Product not found.');
    const product = await getProduct(req.params.id);
    if (!product) return fail(res, 404, 'Product not found.');
    const inputs = { productId: [sql.Int, Number(req.params.id)] };
    const receiving = await db.query(`
      SELECT id, CONVERT(char(10), receiving_date, 23) AS [date], material_lot_number AS materialLotNumber,
             mak_release_number AS makReleaseNumber, quantity, remarks
      FROM dbo.receiving_transactions WHERE product_id = @productId ORDER BY receiving_date DESC, id DESC
    `, inputs);
    const usage = await db.query(`
      SELECT id, CONVERT(char(10), usage_date, 23) AS [date], material_lot_number AS materialLotNumber,
             mak_lot_number AS makLotNumber, quantity, remarks
      FROM dbo.usage_transactions WHERE product_id = @productId ORDER BY usage_date DESC, id DESC
    `, inputs);
    res.json({ product, receiving: receiving.recordset, usage: usage.recordset });
  }));
  app.use('/api', (_req, res) => fail(res, 404, 'API endpoint not found.'));
  if (serveClient) {
    if (process.env.NODE_ENV === 'production' || process.argv.includes('--production')) {
      app.use(express.static(clientDirectory));
      app.get('*', (_req, res) => res.sendFile(path.join(clientDirectory, 'index.html')));
    } else app.get('/', (_req, res) => res.redirect('http://localhost:5173/'));
  }
  app.use((error, _req, res, _next) => {
    console.error('Inventory API error:', error.code || error.number || error.name);
    if (error.status === 503) return fail(res, 503, error.message);
    if (error.code === 'ETIMEOUT') return fail(res, 503, connectionFailure(error).message);
    if (error.type === 'entity.parse.failed') return fail(res, 400, 'Invalid JSON request.');
    if ([2628, 8152].includes(error.number)) return fail(res, 400, 'A value exceeds the configured database field length.');
    return fail(res, 500, 'An unexpected server error occurred.');
  });
  return app;
}
