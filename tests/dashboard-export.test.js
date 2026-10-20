import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import test from 'node:test';
import { Children, createElement, isValidElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('dashboard advertises Excel export with a busy state while Product Master retains CSV', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: DashboardPage } = await vite.ssrLoadModule('/src/pages/dashboard/DashboardPage.jsx');
    const { default: ProductsPage } = await vite.ssrLoadModule('/src/pages/products/ProductsPage.jsx');
    const props = { products: [], allProducts: [], types: [], search: '', typeFilter: '' };
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

function findElement(element, predicate) {
  if (!isValidElement(element)) return undefined;
  if (predicate(element)) return element;
  return Children.toArray(element.props.children).map((child) => findElement(child, predicate)).find(Boolean);
}

test('dashboard export menu lists all registered types and invokes distinct summary or type exports', async () => {
  const vite = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: { server: createHttpServer() }, watch: null }, appType: 'custom' });
  try {
    const { default: DashboardExportMenu } = await vite.ssrLoadModule('/src/components/DashboardExportMenu.jsx');
    const types = [{ id: 1, name: 'Bulk' }, { id: 2, name: 'IFC' }, { id: 3, name: 'Label' }, { id: 9, name: 'New empty type' }];
    const calls = [];
    const render = (selection) => {
      function OpenMenu() {
        const [step, setStep] = useState(0);
        const menu = DashboardExportMenu({ types, onExport: (id) => calls.push(id), exporting: false });
        if (step === 0) {
          findElement(menu, (element) => element.type === 'button' && element.props['aria-controls']).props.onClick();
          setStep(1);
        } else if (step === 1 && selection !== undefined) {
          findElement(menu, (element) => element.type === 'button' && (selection === ''
            ? Array.isArray(element.props.children) && element.props.children[0] === 'All product types '
            : element.props.children === selection)).props.onClick();
          setStep(2);
        }
        return menu;
      }
      return renderToStaticMarkup(createElement(OpenMenu));
    };
    const open = render();
    assert.match(open, /aria-expanded="true"/);
    assert.match(open, /All product types/);
    assert.match(open, /Stock summary/);
    for (const type of types) assert.ok(open.includes(`>${type.name}</button>`));
    assert.match(open, /Product-wise history by type/);
    assert.doesNotMatch(render('Bulk'), /id="dashboard-export-options"/);
    assert.deepEqual(calls, ['1']);
    render('');
    assert.deepEqual(calls, ['1', '']);
    render('New empty type');
    assert.deepEqual(calls, ['1', '', '9']);
    const busy = renderToStaticMarkup(createElement(DashboardExportMenu, { types, exporting: true, onExport() {} }));
    assert.match(busy, /disabled=""/);
    assert.match(busy, /Exporting…/);
    assert.doesNotMatch(busy, /role="group"/);
  } finally { await vite.close(); }
});
