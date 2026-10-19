import TransactionPage from '../../components/TransactionPage.jsx';

export default function ReceivingPage({ products, onSaved }) {
  return <TransactionPage kind="receiving" products={products} onSaved={onSaved} />;
}
