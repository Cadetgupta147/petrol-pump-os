import { apiFetch } from './client';
import type { Customer, CustomerLedger } from './types';

export function getAllCustomers(): Promise<Customer[]> {
  return apiFetch<Customer[]>('/customers');
}

export function getCustomer(id: string): Promise<Customer> {
  return apiFetch<Customer>(`/customers/${id}`);
}

// GET /customers/:id/ledger — every bill + payment for this customer in
// chronological order, with a running balance (CustomersService.ledger()).
// This is the real "click into the detail" destination for a credit alert
// or an overdue-customer count on the dashboard.
export function getCustomerLedger(id: string): Promise<CustomerLedger> {
  return apiFetch<CustomerLedger>(`/customers/${id}/ledger`);
}
