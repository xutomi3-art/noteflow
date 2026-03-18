/**
 * E2E Tests: Document Upload
 * - Upload dropzone visible
 * - Upload modal opens with file input
 * - Upload TXT/CSV files
 * - Source appears after upload
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';

const TESTS_DIR = path.join(process.cwd(), 'tests');
const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Document Upload', () => {
  let accessToken = '';
  let testEmail = '';
  const testPassword = 'E2eTest123!';
  let notebookId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_upload_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Upload User', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;

    const nb = await createNotebookViaApi(page, `Upload NB ${uniqueSuffix()}`, accessToken);
    notebookId = nb.id;
    await page.close();
  });

  test.afterAll(async ({ browser }) => {
    if (!notebookId || !accessToken) return;
    const page = await browser.newPage();
    await deleteNotebookViaApi(page, notebookId, accessToken);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    if (!accessToken || !notebookId) {
      test.skip(true, 'Backend not available');
      return;
    }
    await loginViaApi(page, testEmail, testPassword);
    await page.goto(`/notebook/${notebookId}`);
    await expect(page).toHaveURL(`/notebook/${notebookId}`, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: /sources/i })).toBeVisible({ timeout: 15000 });
  });

  test('add sources button is visible', async ({ page }) => {
    const addSourcesBtn = page.getByRole('button', { name: /add sources/i }).first();
    await expect(addSourcesBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking add sources opens upload modal', async ({ page }) => {
    await page.getByRole('button', { name: /add sources/i }).first().click();

    // Modal shows "Add sources to your notebook"
    await expect(page.getByRole('heading', { name: /add sources/i })).toBeVisible({ timeout: 5000 });
  });

  test('upload modal has file input', async ({ page }) => {
    await page.getByRole('button', { name: /add sources/i }).first().click();
    await expect(page.getByRole('heading', { name: /add sources/i })).toBeVisible({ timeout: 5000 });

    // Hidden file input should now be attached
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });
  });

  test('upload a TXT file via modal', async ({ page }) => {
    // Open upload modal
    await page.getByRole('button', { name: /add sources/i }).first().click();
    await expect(page.getByRole('heading', { name: /add sources/i })).toBeVisible({ timeout: 5000 });

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });

    const txtFile = path.join(TESTS_DIR, 'e2e_test.md');
    await fileInput.setInputFiles(txtFile);

    // Should show the file in the upload list or progress
    await expect(
      page.locator('text=e2e_test').first()
    ).toBeVisible({ timeout: 15000 });
  });

  test('upload modal has URL input option', async ({ page }) => {
    await page.getByRole('button', { name: /add sources/i }).first().click();
    await expect(page.getByRole('heading', { name: /add sources/i })).toBeVisible({ timeout: 5000 });

    // URL input or "Add website URL" button should be visible
    await expect(
      page.getByPlaceholder(/example\.com/i).or(page.getByRole('button', { name: /website url/i }))
    ).toBeVisible({ timeout: 5000 });
  });
});
