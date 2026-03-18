import type { Page } from '@playwright/test';

export const TEST_USER = {
  name: 'E2E Test User',
  email: `e2e_${Date.now()}@test.com`,
  password: 'E2eTest123',
};

// Stable test user for login tests (must exist in DB)
export const EXISTING_USER = {
  email: 'e2e@noteflow-test.com',
  password: 'E2eTest123',
};

/**
 * Log in programmatically via API (no UI), then set localStorage tokens.
 * Much faster than going through the login form for each test.
 */
export async function loginViaApi(page: Page, email: string, password: string) {
  const response = await page.request.post(`/api/auth/login`, {
    data: { email, password },
  });

  if (response.status() === 500) {
    throw new Error(`Backend not available (proxy 500)`);
  }

  if (!response.ok()) {
    throw new Error(`Login API failed: ${response.status()} - ${await response.text()}`);
  }

  const tokens = await response.json();
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t.access_token);
    localStorage.setItem('refresh_token', t.refresh_token);
  }, tokens);

  return tokens;
}

/**
 * Register a new user via API and set localStorage tokens.
 */
export async function registerViaApi(page: Page, name: string, email: string, password: string) {
  const response = await page.request.post(`/api/auth/register`, {
    data: { email, name, password },
  });

  if (!response.ok()) {
    const body = await response.text();
    throw new Error(`Register API failed: ${response.status()} - ${body}`);
  }

  const tokens = await response.json();
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t.access_token);
    localStorage.setItem('refresh_token', t.refresh_token);
  }, tokens);

  return tokens;
}

/**
 * Create a notebook via API.
 */
export async function createNotebookViaApi(
  page: Page,
  name: string,
  accessToken: string
): Promise<{ id: string; name: string }> {
  const response = await page.request.post(`/api/notebooks`, {
    data: { name, emoji: '📝', cover_color: '#ecfccb' },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok()) {
    throw new Error(`Create notebook API failed: ${response.status()}`);
  }

  return response.json();
}

/**
 * Delete a notebook via API (cleanup).
 */
export async function deleteNotebookViaApi(
  page: Page,
  notebookId: string,
  accessToken: string
) {
  await page.request.delete(`/api/notebooks/${notebookId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
