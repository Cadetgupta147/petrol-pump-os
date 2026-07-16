import { apiFetch } from './client';
import type { LoginResponse } from './types';

// POST /auth/login — Section 2 web portal login, identified by Staff.phone
// (see apps/backend/src/auth/dto/login.dto.ts). Owner/Accountant only today;
// Manager/Read-only once those roles get real endpoints.
export function login(phone: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ phone, password }),
  });
}
