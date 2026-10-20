import { useSearchParams } from 'react-router-dom';
import TransactionPage from '../../components/TransactionPage.jsx';

export default function UsagePage({ products, types, onSaved }) {
  const [params] = useSearchParams();
  const productId = params.get('productId') || '';
  return <TransactionPage key={productId} kind="usage" products={products} types={types} onSaved={onSaved} initialProductId={productId} />;
}
