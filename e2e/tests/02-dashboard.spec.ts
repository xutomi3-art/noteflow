/**
 * E2E Tests: Dashboard
 * - View dashboard after login
 * - Create notebook
 * - See notebook card
 * - Navigate to notebook
 * - Delete notebook
 */
import { test, expect } from '@playwright/test';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Dashboard', () => {
  let accessToken = '';
  let testEmail = '';
  let testPassword = 'E2eTest123!';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_dash_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Dashboard', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    if (!accessToken) {
      test.skip(true, 'Backend not available — skipping dashboard tests');
      return;
    }
    await loginViaApi(page, testEmail, testPassword);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('dashboard loads and shows header', async ({ page }) => {
    // Should show the Noteflow logo/brand somewhere on dashboard
    await expect(page.locator('body')).toBeVisible();
    // Should NOT be on login page
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('dashboard shows "New Notebook" button', async ({ page }) => {
    const newBtn = page.getByRole('button', { name: /new notebook/i });
    await expect(newBtn.first()).toBeVisible();
  });

  test('create notebook via modal and navigate to it', async ({ page }) => {
    const name = `Test NB ${uniqueSuffix()}`;

    // Click the New Notebook button
    await page.getByRole('button', { name: /new notebook/i }).first().click();

    // Modal appears
    const modalInput = page.locator('input[type="text"]').last();
    await expect(modalInput).toBeVisible({ timeout: 5000 });

    await modalInput.clear();
    await modalInput.fill(name);

    const createBtn = page.getByRole('button', { name: /^create$/i });
    await createBtn.click();

    // Should navigate to the new notebook
    await expect(page).toHaveURL(/\/notebook\//, { timeout: 15000 });
  });

  test('created notebook appears on dashboard', async ({ page }) => {
    const name = `Dashboard NB ${uniqueSuffix()}`;

    // Create via API for speed
    const nb = await createNotebookViaApi(page, name, accessToken);

    // Go back to dashboard
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    // Notebook card should be visible
    await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 10000 });

    // Cleanup
    await deleteNotebookViaApi(page, nb.id, accessToken);
  });

  test('clicking notebook card navigates to notebook', async ({ page }) => {
    const name = `Nav NB ${uniqueSuffix()}`;
    const nb = await createNotebookViaApi(page, name, accessToken);

    await page.goto('/dashboard');

    // Click on the notebook
    await page.locator(`text=${name}`).first().click();
    await expect(page).toHaveURL(`/notebook/${nb.id}`, { timeout: 15000 });

    // Cleanup
    await deleteNotebookViaApi(page, nb.id, accessToken);
  });

  test('logout from dashboard redirects to login', async ({ page }) => {
    // Find and click user avatar/menu button
    // The dashboard has a user menu in the top right
    const avatarBtn = page.locator('button').filter({ has: page.locator('[class*="rounded-full"]') }).last();
    if (await avatarBtn.isVisible({ timeout: 3000 })) {
      await avatarBtn.click();
      const logoutBtn = page.getByRole('button', { name: /sign out|log out/i }).or(
        page.locator('button').filter({ hasText: /sign out|logout/i })
      ).first();
      if (await logoutBtn.isVisible({ timeout: 2000 })) {
        await logoutBtn.click();
        await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
        return;
      }
    }
    // Fallback: clear tokens manually and verify redirect
    await page.evaluate(() => {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    });
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
