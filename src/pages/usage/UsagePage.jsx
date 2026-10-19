import TransactionPage from '../../components/TransactionPage.jsx';

export default function UsagePage({ products, onSaved }) {
  return <TransactionPage kind="usage" products={products} onSaved={onSaved} />;
}
