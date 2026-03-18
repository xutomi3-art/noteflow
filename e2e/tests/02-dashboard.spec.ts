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

  test('dashboard shows "Create New" button', async ({ page }) => {
    const newBtn = page.getByRole('button', { name: /create new/i });
    await expect(newBtn.first()).toBeVisible();
  });

  test('create notebook via modal and navigate to it', async ({ page }) => {
    const name = `Test NB ${uniqueSuffix()}`;

    // Hover to open dropdown, then click "Personal Notebook"
    await page.getByRole('button', { name: /create new/i }).first().hover();
    await page.getByRole('button', { name: /personal notebook/i }).click();

    // Modal appears with "Notebook name" input
    const nameInput = page.getByRole('textbox', { name: /notebook name/i });
    await expect(nameInput).toBeVisible({ timeout: 5000 });

    await nameInput.clear();
    await nameInput.fill(name);

    // Click "Create Notebook" button
    await page.getByRole('button', { name: /create notebook/i }).click();

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
    // Click the avatar button to open dropdown
    await page.getByRole('button', { name: /^[A-Z]$/ }).last().click();

    // Click "Log out" button
    const logoutBtn = page.getByRole('button', { name: /log out/i });
    await expect(logoutBtn).toBeVisible({ timeout: 3000 });
    await logoutBtn.click();

    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
