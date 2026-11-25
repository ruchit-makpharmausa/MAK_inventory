import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AppLayout from './components/AppLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import ProductModal from './components/ProductModal.jsx';
import ExportDateRangeDialog from './components/ExportDateRangeDialog.jsx';
import CompanySelection from './components/CompanySelection.jsx';
import DashboardPage from './pages/dashboard/DashboardPage.jsx';
import LoginPage from './pages/login/LoginPage.jsx';
import ProductsPage from './pages/products/ProductsPage.jsx';
import ReceivingPage from './pages/receiving/ReceivingPage.jsx';
import UsagePage from './pages/usage/UsagePage.jsx';
import InventoryHistoryPage from './pages/history/InventoryHistoryPage.jsx';
import ShippedProductsPage from './pages/shipments/ShippedProductsPage.jsx';
import LotInventoryPage from './pages/lots/LotInventoryPage.jsx';
import AdminPage from './pages/admin/AdminPage.jsx';
import AuditLogPage from './pages/audit/AuditLogPage.jsx';
import NotFoundPage from './pages/not-found/NotFoundPage.jsx';
import api from './lib/api.js';
import { exportCsv } from './lib/csv.js';
import { exportInventoryWorkbook } from './lib/inventory-workbook.js';
import { exportTypeHistoryWorkbook } from './lib/type-history-workbook.js';
import { loginDestination } from './lib/routes.js';
import { filterTypeHistoryReport, inExportDateRange } from './lib/export-date-range.js';

function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [types, setTypes] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editingProduct, setEditingProduct] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportRequest, setExportRequest] = useState(null);
  const exportInProgress = useRef(false);

  useEffect(() => {
    api('/api/auth/session')
      .then(({ user: currentUser }) => setUser(currentUser))
      .catch((error) => setAuthError(error.message))
      .finally(() => setAuthLoading(false));
  }, []);

  const signIn = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setAuthBusy(true);
    setAuthError('');
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
      });
      setUser(result.user);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const switchCompany = async () => {
    try {
      const result = await api('/api/auth/company/clear', { method: 'POST' });
      setUser(result.user);
      setProducts([]);
      setAllProducts([]);
      setTypes([]);
      setShipments([]);
      setSearch('');
      setTypeFilter('');
      setEditingProduct(null);
      setMessage(null);
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    }
  };

  const signOut = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setUser(null);
      setProducts([]);
      setAllProducts([]);
      setTypes([]);
      setShipments([]);
      setSearch('');
      setTypeFilter('');
      setEditingProduct(null);
      setMessage(null);
      setAuthError('');
      navigate('/login', { replace: true });
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    }
  };

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams({ search, typeId: typeFilter });
    const [all, filtered] = await Promise.all([
      api('/api/products'),
      api(`/api/products?${params}`),
    ]);
    setAllProducts(all);
    setProducts(filtered);
  }, [search, typeFilter]);

  const loadBase = useCallback(async () => {
    const productTypes = await api('/api/product-types');
    setTypes(productTypes);
  }, []);

  const loadShipments = useCallback(async () => {
    setShipments(await api('/api/shipments'));
  }, []);

  useEffect(() => {
    if (!user?.company) return;
    loadProducts().catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [loadProducts, user]);

  useEffect(() => {
    if (!user?.company) return;
    loadBase().catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [loadBase, user]);

  useEffect(() => {
    if (!user?.company) return;
    loadShipments().catch((error) => setMessage({ kind: 'error', text: error.message }));
  }, [loadShipments, user?.company?.id]);

  const refresh = useCallback(async () => {
    await Promise.all([loadProducts(), loadBase(), loadShipments()]);
  }, [loadBase, loadProducts, loadShipments]);

  const openHistory = (id) => navigate(`/inv_history${id ? `?productId=${encodeURIComponent(id)}` : ''}`);

  useEffect(() => {
    setMessage(null);
    setEditingProduct(null);
  }, [location.pathname]);

  const onTransactionSaved = async (kind) => {
    setMessage({ kind: 'success', text: kind === 'transfer' ? 'Inventory transfer saved.'
      : kind === 'shipment' ? 'Shipment saved to the Shipped Products log.'
        : `${kind === 'receiving' ? 'Receiving' : 'Usage'} transaction saved.` });
    await refresh();
  };

  const exportDashboard = (typeId = '') => setExportRequest({ typeId });

  const performDashboardExport = async ({ fromDate, toDate }) => {
    const range = { fromDate, toDate };
    const fetchForExport = async (label, url) => {
      try {
        return await api(url);
      } catch (error) {
        throw new Error(`${label}: ${error?.message || 'request failed.'}`);
      }
    };
    if (exportInProgress.current) return;
    exportInProgress.current = true;
    setExporting(true);
    try {
      if (exportRequest?.typeId) {
        const report = await fetchForExport('Product-type history request failed',
          `/api/product-types/${encodeURIComponent(exportRequest.typeId)}/history`);
        const filteredReport = filterTypeHistoryReport(report, range);
        await exportTypeHistoryWorkbook(filteredReport);
        setMessage({ kind: 'success', text: `${report.type.name} product history workbook downloaded.` });
      } else {
        const [receiving, usage, shipmentRows] = await Promise.all([
          fetchForExport('Receiving history request failed', '/api/transactions/receiving'),
          fetchForExport('Usage history request failed', '/api/transactions/usage'),
          fetchForExport('Shipment log request failed', '/api/shipments'),
        ]);
        await exportInventoryWorkbook(allProducts, types, {
          receiving: receiving.filter((row) => inExportDateRange(row, range)),
          usage: usage.filter((row) => inExportDateRange(row, range)),
          shipments: shipmentRows.filter((row) => inExportDateRange(row, range)),
        });
        setMessage({ kind: 'success', text: 'Inventory Excel workbook downloaded.' });
      }
    } catch (error) {
      setMessage({ kind: 'error', text: `Unable to export the Excel workbook. ${error?.message || 'Please try again.'}` });
    } finally {
      exportInProgress.current = false;
      setExporting(false);
      setExportRequest(null);
    }
  };

  const exportSummary = () => exportCsv(
    'mak-inventory-summary.csv',
    ['Product Type', 'Item Code', 'MAK Item Code', 'Product Name', 'Total Received', 'Total Used', 'Available Balance', 'Unit', 'Comment'],
    allProducts.map((p) => [p.productType, p.itemCode, p.makItemCode, p.name, p.totalReceived, p.totalUsed, p.availableBalance, p.unit, p.comment]),
  );

  const addProductType = async () => {
    const name = window.prompt('Enter the new product type');
    if (!name?.trim()) return;
    try {
      const type = await api('/api/product-types', { method: 'POST', body: JSON.stringify({ name }) });
      setTypes((current) => [...current, type].sort((a, b) => a.name.localeCompare(b.name)));
      setMessage({ kind: 'success', text: `Product type "${type.name}" added.` });
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    }
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(form.entries());
    body.productTypeId = Number(body.productTypeId);
    const productId = editingProduct?.id;
    setBusy(true);
    try {
      await api(productId ? `/api/products/${productId}` : '/api/products', {
        method: productId ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      setEditingProduct(null);
      setMessage({ kind: 'success', text: 'Product saved.' });
      await refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) return <div className="auth-loading" role="status">Checking your sign-in…</div>;
  if (user && !user.company) return <CompanySelection user={user} onSelected={setUser} />;

  return <>
    <Routes>
      <Route path="/login" element={user
        ? <Navigate to={loginDestination(location.state?.from, user.isAdmin)} replace />
        : <LoginPage error={authError} busy={authBusy} onSubmit={signIn} />} />
      <Route element={<ProtectedRoute user={user} />}>
        <Route element={<AppLayout user={user} message={message} onSignOut={signOut} onSwitchCompany={switchCompany}
          onDismiss={() => setMessage(null)} />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage
            products={products} allProducts={allProducts}
            shipments={shipments}
            search={search} setSearch={setSearch} typeFilter={typeFilter} setTypeFilter={setTypeFilter}
            types={types} onHistory={openHistory} onExport={exportDashboard} exporting={exporting} />} />
          <Route path="/products" element={<ProductsPage products={allProducts} search={search}
            setSearch={setSearch} types={types} onAddType={addProductType}
            onEdit={setEditingProduct} onHistory={openHistory} onExport={exportSummary} />} />
          <Route path="/receiving" element={<ReceivingPage products={allProducts} types={types} onSaved={onTransactionSaved} />} />
          <Route path="/usage" element={<UsagePage products={allProducts} types={types} onSaved={onTransactionSaved} />} />
          <Route path="/inv_history" element={<InventoryHistoryPage products={allProducts} types={types} onSaved={onTransactionSaved} user={user} />} />
          <Route path="/shipped-products" element={<ShippedProductsPage />} />
          <Route path="/lot-inventory" element={<LotInventoryPage products={allProducts} types={types} user={user} onSaved={onTransactionSaved} />} />
          <Route path="/audit-log" element={user?.isAdmin ? <AuditLogPage /> : <Navigate to="/dashboard" replace />} />
          <Route path="/history" element={<Navigate to={`/inv_history${location.search}${location.hash}`} replace />} />
          <Route path="/admin" element={user?.isAdmin ? <AdminPage api={api} /> : <Navigate to="/dashboard" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
    {user && editingProduct && <ProductModal editingProduct={editingProduct} types={types}
      onAddType={addProductType} onSubmit={saveProduct} onClose={() => setEditingProduct(null)} busy={busy} />}
    {exportRequest && <ExportDateRangeDialog typeName={exportRequest.typeId
      ? types.find((type) => String(type.id) === String(exportRequest.typeId))?.name || 'Selected type' : 'All product types'}
      exporting={exporting} onClose={() => { if (!exporting) setExportRequest(null); }} onExport={performDashboardExport} />}
  </>;
}

export default App;
