import { useState, type FormEvent } from 'react';
import { createStaff, updateStaff } from '../../api/staffManagement';
import { ApiError } from '../../api/client';
import type { Role, Staff } from '../../api/types';

interface StaffFormModalProps {
  // Presence of `staffMember` selects the mode: PATCH (edit) an existing row
  // vs. POST (add) a new one — same convention as CustomerFormModal. Role is
  // fixed once created (see UpdateStaffRequest's comment) — the add form
  // picks it, the edit form only displays it.
  staffMember?: Staff;
  onClose: () => void;
  onSaved: (staff: Staff) => void;
}

const ROLES: Role[] = ['OWNER', 'ACCOUNTANT', 'MANAGER', 'DSM', 'READ_ONLY'];

// DSM logs in with a numeric PIN; every other role logs in with a password
// (Staff schema comment, enforced server-side in StaffManagementService).
function credentialKindFor(role: Role): 'pin' | 'password' {
  return role === 'DSM' ? 'pin' : 'password';
}

export function StaffFormModal({ staffMember, onClose, onSaved }: StaffFormModalProps) {
  const isEdit = staffMember !== undefined;
  const [name, setName] = useState(staffMember?.name ?? '');
  const [phone, setPhone] = useState(staffMember?.phone ?? '');
  const [role, setRole] = useState<Role>(staffMember?.role ?? 'DSM');
  const [active, setActive] = useState(staffMember?.active ?? true);
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const credentialKind = credentialKindFor(isEdit ? staffMember.role : role);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const trimmedCredential = credential.trim();

      const saved = isEdit
        ? await updateStaff(staffMember.id, {
            name: name.trim(),
            phone: phone.trim(),
            active,
            // Blank credential field in edit mode = "leave it unchanged".
            ...(trimmedCredential === ''
              ? {}
              : credentialKind === 'pin'
                ? { pin: trimmedCredential }
                : { password: trimmedCredential }),
          })
        : await createStaff({
            name: name.trim(),
            phone: phone.trim(),
            role,
            ...(credentialKind === 'pin' ? { pin: trimmedCredential } : { password: trimmedCredential }),
          });

      onSaved(saved);
    } catch (err) {
      // Backend validation (phone format, pin/password-vs-role cross rule,
      // duplicate phone) is the real enforcement — surfaced as-is.
      setError(err instanceof ApiError ? err.message : "Can't reach the backend.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onClick={(event) => event.stopPropagation()} onSubmit={(e) => { void handleSubmit(e); }}>
        <div className="section-title">
          <h3>{isEdit ? 'Edit staff' : 'Add staff'}</h3>
        </div>

        <div className="form-field">
          <label htmlFor="sf-name">Name</label>
          <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-field">
          <label htmlFor="sf-phone">Phone</label>
          <input
            id="sf-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9990000001"
            required
          />
        </div>
        <div className="form-field">
          <label htmlFor="sf-role">Role</label>
          {isEdit ? (
            <input id="sf-role" value={staffMember.role} disabled />
          ) : (
            <select id="sf-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>

        {isEdit && (
          <label className="form-checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        )}

        <div className="form-field">
          <label htmlFor="sf-credential">
            {credentialKind === 'pin' ? 'PIN (4-8 digits)' : 'Password (min. 8 characters)'}
          </label>
          <input
            id="sf-credential"
            type={credentialKind === 'pin' ? 'text' : 'password'}
            inputMode={credentialKind === 'pin' ? 'numeric' : undefined}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            placeholder={isEdit ? 'Leave blank to keep the current one' : undefined}
            required={!isEdit}
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="export-btn" disabled={submitting}>
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Add staff'}
          </button>
        </div>
      </form>
    </div>
  );
}
