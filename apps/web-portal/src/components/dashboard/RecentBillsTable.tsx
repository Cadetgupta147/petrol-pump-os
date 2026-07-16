import { useNavigate } from 'react-router-dom';
import type { RecentBill } from '../../api/types';
import { formatRupees, formatTime } from '../../utils/format';

interface RecentBillsTableProps {
  bills: RecentBill[];
}

function dominantPaymentMode(bill: RecentBill): string {
  const entries = Object.entries(bill.byPaymentType).filter(([, v]) => v !== 0);
  if (entries.length === 0) return '—';
  if (entries.length > 1) return 'Split';
  const [type] = entries[0];
  return type === 'CARD' ? 'POS' : type[0] + type.slice(1).toLowerCase();
}

export function RecentBillsTable({ bills }: RecentBillsTableProps) {
  const navigate = useNavigate();

  if (bills.length === 0) {
    return <div className="empty-box">No bills recorded yet.</div>;
  }

  return (
    <div className="table-card">
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Customer</th>
            <th className="num">Amount</th>
            <th>Mode</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
            <tr
              key={bill.id}
              className="clickable-row"
              onClick={() => navigate(`/bills/${bill.id}`)}
            >
              <td>{formatTime(bill.timestamp)}</td>
              <td>{bill.customerName ?? bill.vehicleNumber ?? 'Walk-in'}</td>
              <td className="num">{formatRupees(bill.amount)}</td>
              <td>{dominantPaymentMode(bill)}</td>
              <td className="chevron">&rsaquo;</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
