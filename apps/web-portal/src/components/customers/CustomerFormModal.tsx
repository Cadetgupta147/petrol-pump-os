import { useState, type FormEvent } from 'react';
import { createCustomer, updateCustomer } from '../../api/customers';
import { ApiError } from '../../api/client';
import type { Customer } from '../../api/types';

interface CustomerFormModalProps {
  // Presence of `customer` selects the mode: PATCH (edit, Section 3.4) an
  // existing row vs. POST (add) a new one. Editing is seeded from the row
  // object CustomersPage already has from getAllCustomers() — no extra
  // fetch needed (see the comment on the deleted getCustomer() in
  // api/customers.ts).
  customer?: Customer;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

export function CustomerFormModal({ customer, onClose, onSaved }: CustomerFormModalProps) {
  const isEdit = customer !== undefined;
  const [name, setName] = useState(customer?.name ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [vehicleNumber, setVehicleNumber] = useState(customer?.vehicleNumber ?? '');
  // Section 3.4B — fleet/company this vehicle bills under, dealer-set only.
  // Used purely for company-scope blacklist matching + reporting; leaving
  // it blank is the normal case for a customer with no fleet affiliation.
  const [companyName, setCompanyName] = useState(customer?.companyName ?? '');
  const [creditLimit, setCreditLimit] = useState(customer ? String(customer.creditLimit) : '');
  // Section 17.24 — ID-document capture, optional/dealer's-discretion. Both
  // or neither — the backend rejects one without the other.
  const [idDocumentType, setIdDocumentType] = useState(customer?.idDocumentType ?? '');
  const [idDocumentNumber, setIdDocumentNumber] = useState(customer?.idDocumentNumber ?? '');
  // Section 3.4A — the informal -> verified upgrade. Only surfaced in edit
  // mode: a brand-new customer added here always starts VERIFIED per the
  // backend (CreateCustomerDto has no verificationStatus field at all), so
  // there's nothing to toggle on the add form.
  const [verified, setVerified] = useState(customer?.verificationStatus === 'VERIFIED');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedVehicle = vehicleNumber.trim();
      const trimmedCreditLimit = creditLimit.trim();
      const parsedCreditLimit = trimmedCreditLimit === '' ? undefined : Number(trimmedCreditLimit);

      const trimmedCompanyName = companyName.trim();
      const trimmedIdDocumentType = idDocumentType.trim();
      const trimmedIdDocumentNumber = idDocumentNumber.trim();

      const saved = isEdit
        ? await updateCustomer(customer.id, {
            name: name.trim(),
            phone: phone.trim(),
            vehicleNumber: trimmedVehicle === '' ? undefined : trimmedVehicle,
            companyName: trimmedCompanyName === '' ? undefined : trimmedCompanyName,
            creditLimit: parsedCreditLimit,
            idDocumentType: trimmedIdDocumentType === '' ? undefined : trimmedIdDocumentType,
            idDocumentNumber: trimmedIdDocumentNumber === '' ? undefined : trimmedIdDocumentNumber,
            verificationStatus: verified ? 'VERIFIED' : 'INFORMAL',
          })
        : await createCustomer({
            name: name.trim(),
            phone: phone.trim(),
            vehicleNumber: trimmedVehicle === '' ? undefined : trimmedVehicle,
            companyName: trimmedCompanyName === '' ? undefined : trimmedCompanyName,
            creditLimit: parsedCreditLimit,
            idDocumentType: trimmedIdDocumentType === '' ? undefined : trimmedIdDocumentType,
            idDocumentNumber: trimmedIdDocumentNumber === '' ? undefined : trimmedIdDocumentNumber,
          });

      onSaved(saved);
    } catch (err) {
      // Backend validation (e.g. the @IsPhoneNumber('IN') format check) is
      // the real enforcement — we just surface whatever message it sends
      // back rather than re-validating client-side.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>{isEdit ? 'Edit customer' : 'Add customer'}</h3>
        </div>

        <div className="form-field">
          <label htmlFor="cf-name">Name</label>
          <input
            id="cf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-phone">Phone</label>
          <input
            id="cf-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9990000001"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-vehicle">Vehicle number</label>
          <input
            id="cf-vehicle"
            value={vehicleNumber}
            onChange={(e) => setVehicleNumber(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-company">Company/fleet (optional)</label>
          <input
            id="cf-company"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="For company-scope blacklisting only (Section 3.4B)"
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-credit">Credit limit (Rs.)</label>
          <input
            id="cf-credit"
            type="number"
            min="0"
            step="1"
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            placeholder="0"
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-id-type">ID document type (Section 17.24, optional)</label>
          <input
            id="cf-id-type"
            value={idDocumentType}
            onChange={(e) => setIdDocumentType(e.target.value)}
            placeholder="e.g. Aadhaar, Driving License — dealer's discretion"
          />
        </div>
        <div className="form-field">
          <label htmlFor="cf-id-number">ID document number</label>
          <input
            id="cf-id-number"
            value={idDocumentNumber}
            onChange={(e) => setIdDocumentNumber(e.target.value)}
            placeholder="Must be set together with the type above, or both left blank"
          />
        </div>

        {isEdit && (
          <label className="form-checkbox">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
            Verified customer
          </label>
        )}

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}
          </button>
        </div>
      </form>
    </div>
  );
}
