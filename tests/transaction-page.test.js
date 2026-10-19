import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('receiving uses MAK RN Number while usage and the submitted field name remain unchanged', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: TransactionPage } = await vite.ssrLoadModule('/src/components/TransactionPage.jsx');
    const render = (kind) => renderToStaticMarkup(createElement(TransactionPage, { kind, products: [], onSaved: async () => {} }));
    const receiving = render('receiving');
    assert.match(receiving, /<label>MAK RN Number<span class="muted-label"> \(optional\)<\/span>/);
    assert.match(receiving, /name="materialLotNumber" placeholder="Enter MAK RN Number"/);
    assert.doesNotMatch(receiving, /Enter material lot number/);
    const usage = render('usage');
    assert.match(usage, /<label>Material lot number/);
    assert.match(usage, /name="materialLotNumber" placeholder="Enter material lot number"/);
    assert.doesNotMatch(usage, /MAK RN Number/);
  } finally {
    await vite.close();
  }
});
