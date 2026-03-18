/**
 * E2E Tests: Notebook page
 * - Notebook page loads
 * - Sources panel is present
 * - Chat panel is present
 * - Studio panel is present
 * - Upload area is accessible
 * - Navigation back to dashboard
 */
import { test, expect } from '@playwright/test';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';
import * as path from 'path';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Notebook Page', () => {
  let accessToken = '';
  let testEmail = '';
  const testPassword = 'E2eTest123!';
  let notebookId = '';
  let notebookName = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_nb_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Notebook', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;

    // Create a notebook to use in tests
    notebookName = `E2E Notebook ${uniqueSuffix()}`;
    const nb = await createNotebookViaApi(page, notebookName, accessToken);
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
    // Wait for notebook content to render
    await expect(page.getByRole('heading', { name: /sources/i })).toBeVisible({ timeout: 15000 });
  });

  test('notebook page renders three panels', async ({ page }) => {
    // Sources, Chat, Studio headings should all be visible
    await expect(page.getByRole('heading', { name: /sources/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /chat/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /studio/i })).toBeVisible();
  });

  test('notebook name is visible', async ({ page }) => {
    await expect(page.locator(`text=${notebookName}`).first()).toBeVisible({ timeout: 10000 });
  });

  test('back button navigates to dashboard', async ({ page }) => {
    // The "Noteflow" button in the notebook header navigates back to dashboard
    const backBtn = page.getByRole('button', { name: /noteflow/i }).first();
    await expect(backBtn).toBeVisible({ timeout: 5000 });
    await backBtn.click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
  });

  test('sources panel shows upload option', async ({ page }) => {
    // The upload dropzone is a button with text "Add sources pdf, images, docs, and more..."
    const uploadArea = page.getByRole('button', { name: /add sources/i }).first();
    await expect(uploadArea).toBeVisible({ timeout: 10000 });
  });

  test('chat input is visible', async ({ page }) => {
    // Empty notebook shows disabled "Upload sources to start chatting..."
    // Notebook with sources shows "Start typing..."
    const chatInput = page.getByRole('textbox').last();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
  });

  test('add sources opens upload modal with file input', async ({ page }) => {
    // Click "Add sources" to open upload modal
    await page.getByRole('button', { name: /add sources/i }).first().click();
    await expect(page.getByRole('heading', { name: /add sources/i })).toBeVisible({ timeout: 5000 });

    // File input should now be attached (hidden)
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 5000 });
  });

  test('notebook page has studio panel area', async ({ page }) => {
    // Studio panel has a heading "Studio"
    const studioHeading = page.getByRole('heading', { name: /studio/i });
    await expect(studioHeading).toBeVisible({ timeout: 10000 });
  });
});
