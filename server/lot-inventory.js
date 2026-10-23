import sql from 'mssql';

// Match String.trim(), including historical whitespace-only ledger values.
const lotWhitespace = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const normalizedLot = `NULLIF(TRIM(@lotWhitespace COLLATE Latin1_General_100_BIN2 FROM material_lot_number COLLATE Latin1_General_100_BIN2) COLLATE Latin1_General_100_BIN2, N'' COLLATE Latin1_General_100_BIN2)`;
const inventorySelect = `
  WITH movements AS (
    SELECT product_id AS productId, ${normalizedLot} AS materialLotNumber,
           quantity AS received, CAST(0 AS float) AS used
    FROM dbo.receiving_transactions
    UNION ALL
    SELECT product_id AS productId, ${normalizedLot} AS materialLotNumber,
           CAST(0 AS float) AS received, quantity AS used
    FROM dbo.usage_transactions
  ), buckets AS (
    SELECT productId, materialLotNumber COLLATE Latin1_General_100_BIN2 AS materialLotNumber,
           SUM(received) AS totalReceived, SUM(used) AS totalUsed
    FROM movements
    GROUP BY productId, materialLotNumber COLLATE Latin1_General_100_BIN2
  )
  SELECT p.id AS productId, p.name AS productName, p.item_code AS itemCode,
         p.mak_item_code AS makItemCode, p.product_type_id AS productTypeId,
         pt.name AS productType, p.unit, b.materialLotNumber,
         b.totalReceived, b.totalUsed, b.totalReceived - b.totalUsed AS availableBalance,
         SUM(b.totalReceived - b.totalUsed) OVER (PARTITION BY b.productId) AS productBalance
  FROM buckets b JOIN dbo.products p ON p.id = b.productId
  JOIN dbo.product_types pt ON pt.id = p.product_type_id
  ORDER BY p.id, b.materialLotNumber COLLATE Latin1_General_100_BIN2
`;

export function mountLotInventory(app, db) {
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
  const fail = (res, status, message) => res.status(status).json({ error: message });
  const whitespaceInput = () => ({ lotWhitespace: [sql.NVarChar(25), lotWhitespace] });

  app.get('/api/lot-inventory', route(async (_req, res) => {
    res.json((await db.query(inventorySelect, whitespaceInput())).recordset);
  }));

  app.get('/api/lot-inventory/:productId/history', route(async (req, res) => {
    const productId = Number(req.params.productId);
    if (!/^[1-9]\d*$/.test(req.params.productId) || !Number.isInteger(productId) || productId > 2147483647) {
      return fail(res, 400, 'Select a valid product.');
    }
    const keys = Object.keys(req.query);
    const unassigned = keys.length === 1 && keys[0] === 'unassigned' && req.query.unassigned === '1';
    const lot = keys.length === 1 && keys[0] === 'lot' && typeof req.query.lot === 'string'
      ? req.query.lot.trim() : null;
    if (!unassigned && (!lot || lot.length > 255)) {
      return fail(res, 400, 'Specify one material lot (255 characters or fewer) or unassigned=1.');
    }
    const materialLotNumber = unassigned ? null : lot;
    const productInput = { productId: [sql.Int, productId] };
    const productResult = await db.query(`
      SELECT p.id, p.name, p.item_code AS itemCode, p.mak_item_code AS makItemCode,
             p.product_type_id AS productTypeId, pt.name AS productType, p.unit
      FROM dbo.products p JOIN dbo.product_types pt ON pt.id = p.product_type_id
      WHERE p.id = @productId
    `, productInput);
    const product = productResult.recordset[0];
    if (!product) return fail(res, 404, 'Product not found.');

    const inputs = { ...productInput, ...whitespaceInput(),
      ...(unassigned ? {} : { materialLotNumber: [sql.NVarChar(255), materialLotNumber] }) };
    const lotScope = unassigned ? `${normalizedLot} IS NULL`
      : `${normalizedLot} = @materialLotNumber COLLATE Latin1_General_100_BIN2`;
    const receiving = await db.query(`
      SELECT id, CONVERT(char(10), receiving_date, 23) AS [date], quantity,
             ${normalizedLot} AS materialLotNumber, mak_release_number AS makReleaseNumber, remarks
      FROM dbo.receiving_transactions
      WHERE product_id = @productId AND ${lotScope}
      ORDER BY receiving_date ASC, id ASC
    `, inputs);
    const usage = await db.query(`
      SELECT id, CONVERT(char(10), usage_date, 23) AS [date], quantity,
             ${normalizedLot} AS materialLotNumber, mak_lot_number AS makLotNumber, remarks
      FROM dbo.usage_transactions
      WHERE product_id = @productId AND ${lotScope}
      ORDER BY usage_date ASC, id ASC
    `, inputs);
    if (!receiving.recordset.length && !usage.recordset.length) return fail(res, 404, 'Material lot not found.');
    res.json({ product, materialLotNumber, receiving: receiving.recordset, usage: usage.recordset });
  }));
}
