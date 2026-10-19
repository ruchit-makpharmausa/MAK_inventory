import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('dashboard advertises Excel export with a busy state while Product Master retains CSV', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: DashboardPage } = await vite.ssrLoadModule('/src/pages/dashboard/DashboardPage.jsx');
    const { default: ProductsPage } = await vite.ssrLoadModule('/src/pages/products/ProductsPage.jsx');
    const props = { products: [], types: [], totals: { received: 0, used: 0, balance: 0 }, activeProducts: 0, search: '', typeFilter: '' };
    const html = renderToStaticMarkup(createElement(DashboardPage, props));
    assert.match(html, /Export Excel/);
    assert.doesNotMatch(html, /Export CSV/);
    const busy = renderToStaticMarkup(createElement(DashboardPage, { ...props, exporting: true }));
    assert.match(busy, /disabled=""/);
    assert.match(busy, /Exporting…/);
    assert.match(renderToStaticMarkup(createElement(ProductsPage, props)), /Export CSV/);
  } finally {
    await vite.close();
  }
});
