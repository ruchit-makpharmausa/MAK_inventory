import TransactionPage from '../../components/TransactionPage.jsx';

export default function ReceivingPage({ products, types, onSaved }) {
  return <TransactionPage kind="receiving" products={products} types={types} onSaved={onSaved} />;
}
