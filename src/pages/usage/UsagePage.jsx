import TransactionPage from '../../components/TransactionPage.jsx';

export default function UsagePage({ products, types, onSaved }) {
  return <TransactionPage kind="usage" products={products} types={types} onSaved={onSaved} />;
}
