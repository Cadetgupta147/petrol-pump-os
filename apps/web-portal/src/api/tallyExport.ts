import { getStoredToken, ApiError, parseErrorMessage } from './client';

const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:3000';

// GET /tally-export/xml?from=...&to=... — unlike every other call in this
// app, this endpoint returns a file (Content-Disposition: attachment), not
// JSON, so it can't go through apiFetch<T>(). A plain <a href> or
// window.open() also won't work here since the route sits behind the global
// JwtAuthGuard and needs an Authorization header, which neither can attach.
// Fetching the blob ourselves and triggering the download via a throwaway
// object URL is the only way to send the bearer token and still get a
// "Save As" style download.
export async function downloadTallyExport(from: string, to: string): Promise<void> {
  const token = getStoredToken();
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${API_BASE_URL}/tally-export/xml?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const message = await parseErrorMessage(
      response,
      `Tally export failed (${response.status})`,
    );
    throw new ApiError(response.status, message);
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `tally-export-${from}-to-${to}.xml`;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
