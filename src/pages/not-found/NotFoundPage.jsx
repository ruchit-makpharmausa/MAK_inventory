import { Link } from 'react-router-dom';
import PageHeading from '../../components/PageHeading.jsx';

export default function NotFoundPage() {
  return <>
    <PageHeading eyebrow="404" title="Page not found" subtitle="This address does not match an inventory page." />
    <Link className="button primary" to="/dashboard">Back to dashboard</Link>
  </>;
}
