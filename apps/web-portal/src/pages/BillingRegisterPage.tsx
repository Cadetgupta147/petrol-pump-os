import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/layout/TopBar';
import { NavBar } from '../components/layout/NavBar';
import { getAllBills } from '../api/bills';
import { getAllCustomers } from '../api/customers';
import { getStaffList } from '../api/staff';
import { ApiError } from '../api/client';
import { formatRupees, formatLitres, formatDateTime } from '../utils/format';
import type { Bill, Customer, ListBillsFilters, PaymentType, StaffListItem } from '../api/types';

const PAGE_SIZE = 25;

const PAYMENT_TYPES: PaymentType[] = ['CASH', 'CARD', 'UPI', 'CREDIT'];

interface FilterFormState {
  from: string;
  to: string;
  customerId: string;
  staffId: string;
  paymentType: PaymentType | '';
  vehicleNumber: string;
}

const EMPTY_FILTERS: FilterFormState = {
  from: '',
  to: '',
  customerId: '',
  staffId: '',
  paymentType: '',
  vehicleNumber: '',
};

function toApiFilters(form: FilterFormState, offset: number): ListBillsFilters {
  return {
    from: form.from || undefined,
    to: form.to || undefined,
    customerId: form.customerId || undefined,
    staffId: form.staffId || undefined,
    paymentType: form.paymentType || undefined,
    vehicleNumber: form.vehicleNumber.trim() || undefined,
    limit: PAGE_SIZE,
    offset,
  };
}

function billPaymentSummary(bill: Bill): string {
  if (bill.paymentLines.length === 0) return '—';
  const inLines = bill.paymentLines.filter((line) => line.direction === 'IN');
  return inLines
    .map((line) => (line.paymentType === 'CARD' ? 'POS' : line.paymentType[0] + line.paymentType.slice(1).toLowerCase()))
    .join(' + ');
}

// Section 3.2 — the full bill register: view/search/manage every bill ever
// entered, from any channel. Filters (date range, customer, DSM, payment
// type, vehicle number) per the plan's explicit spec; row click opens the
// existing BillDetailPage, which already has the edit/delete parity built.
export function BillingRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FilterFormState>(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [total, setTotal] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [staff, setStaff] = useState<StaffListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getAllCustomers().then(setCustomers).catch(() => undefined);
    getStaffList().then(setStaff).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAllBills(toApiFilters(form, offset))
      .then((result) => {
        if (cancelled) return;
        setBills(result.bills);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // A fresh search always restarts at page one — an old offset from a
    // wider result set wouldn't make sense against a newly-narrowed filter.
    setOffset(0);
    setLoading(true);
    getAllBills(toApiFilters(form, 0))
      .then((result) => {
        setBills(result.bills);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  function handleReset() {
    setForm(EMPTY_FILTERS);
    setOffset(0);
    setLoading(true);
    getAllBills(toApiFilters(EMPTY_FILTERS, 0))
      .then((result) => {
        setBills(result.bills);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
      })
      .finally(() => setLoading(false));
  }

  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, total);
  const canPrev = offset > 0;
  const canNext = offset + PAGE_SIZE < total;

  return (
    <>
      <TopBar />
      <NavBar />
      <div className="content">
        <div className="content-header">
          <div className="section-title">
            <h3>Billing register</h3>
            <span className="section-note">Section 3.2 — every bill, any channel. Click a row for the full detail/audit trail.</span>
          </div>
        </div>

        <form className="section" onSubmit={handleSubmit}>
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-from">From</label>
              <input
                id="br-from"
                type="date"
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-to">To</label>
              <input
                id="br-to"
                type="date"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-vehicle">Vehicle number</label>
              <input
                id="br-vehicle"
                value={form.vehicleNumber}
                onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
                placeholder="Partial match, e.g. MH12"
              />
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-customer">Customer</label>
              <select
                id="br-customer"
                value={form.customerId}
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
              >
                <option value="">All customers</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-staff">DSM / entered by</label>
              <select
                id="br-staff"
                value={form.staffId}
                onChange={(e) => setForm({ ...form, staffId: e.target.value })}
              >
                <option value="">All staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label htmlFor="br-payment-type">Payment type</label>
              <select
                id="br-payment-type"
                value={form.paymentType}
                onChange={(e) => setForm({ ...form, paymentType: e.target.value as PaymentType | '' })}
              >
                <option value="">All payment types</option>
                {PAYMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === 'CARD' ? 'POS / card' : type[0] + type.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="content-header-right" style={{ marginTop: 12 }}>
            <button type="button" className="btn-secondary" onClick={handleReset} disabled={loading}>
              Reset
            </button>
            <button type="submit" className="export-btn" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </form>

        {error && <div className="error-box">{error}</div>}
        {!error && !bills && <div className="loading">Loading bills…</div>}
        {!error && bills && bills.length === 0 && (
          <div className="empty-box">No bills match these filters.</div>
        )}

        {!error && bills && bills.length > 0 && (
          <>
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Customer / vehicle</th>
                    <th>Product</th>
                    <th className="num">Litres</th>
                    <th className="num">Amount</th>
                    <th>Payment</th>
                    <th>Channel</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => (
                    <tr key={bill.id} className="clickable-row" onClick={() => navigate(`/bills/${bill.id}`)}>
                      <td>{formatDateTime(bill.timestamp)}</td>
                      <td>{bill.customerName ?? bill.vehicleNumber ?? 'Walk-in'}</td>
                      <td>{bill.productType}</td>
                      <td className="num">{formatLitres(bill.litres)}</td>
                      <td className="num">{formatRupees(bill.amount)}</td>
                      <td>{billPaymentSummary(bill)}</td>
                      <td>{bill.entryChannel === 'DSM_APP' ? 'DSM app' : 'Web'}</td>
                      <td className="chevron">
                        <span>&rsaquo;</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="content-header-right" style={{ marginTop: 12 }}>
              <span className="section-note">
                {pageStart}–{pageEnd} of {total}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={!canPrev || loading}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={!canNext || loading}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
