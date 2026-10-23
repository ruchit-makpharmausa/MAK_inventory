import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let TransactionFields;
let UsageMaterialLotSelect;
before(async () => {
  vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  ({ default: TransactionFields } = await vite.ssrLoadModule('/src/components/TransactionFields.jsx'));
  ({ default: UsageMaterialLotSelect } = await vite.ssrLoadModule('/src/components/UsageMaterialLotSelect.jsx'));
});
after(async () => { await vite?.close(); });

test('receiving material lot stays optional free text and independent of the release reference', () => {
  const html = renderToStaticMarkup(createElement(TransactionFields, { kind: 'receiving', productId: '17', unit: 'Pcs' }));
  const lot = html.match(/<input[^>]*name="materialLotNumber"[^>]*>/)?.[0];
  assert.ok(lot);
  assert.match(lot, /maxLength="255"/);
  assert.doesNotMatch(lot, /required/);
  assert.match(html, /name="makReleaseNumber"/);
  assert.doesNotMatch(html, /<select|name="makLotNumber"/);
});

test('usage offers N/A by default rather than an arbitrary material-lot text input', () => {
  const html = renderToStaticMarkup(createElement(TransactionFields, { kind: 'usage', productId: '17', unit: 'Pcs' }));
  const lot = html.match(/<select[^>]*name="materialLotNumber"[^>]*>[\s\S]*?<\/select>/)?.[0];
  assert.ok(lot);
  assert.match(lot, /<option value="" selected="">N\/A<\/option>/);
  assert.doesNotMatch(lot, /required|disabled/);
  assert.match(html, /Loading available material lots/);
  assert.match(html, /name="makLotNumber" required=""/);
  assert.doesNotMatch(html, /<input name="materialLotNumber"|name="makReleaseNumber"/);
});

test('no product keeps only N/A and prompts for a product before loading lots', () => {
  const html = renderToStaticMarkup(createElement(UsageMaterialLotSelect, { productId: '', unit: 'kgs' }));
  assert.match(html, /<select name="materialLotNumber"[^>]*disabled=""/);
  assert.match(html, /Select a product to see its available lots/);
  assert.match(html, /N\/A/);
  assert.doesNotMatch(html, /Loading available/);
});
