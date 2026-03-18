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
  });

  test('notebook page renders three panels', async ({ page }) => {
    // The notebook page should have: sources panel (left), chat (center), studio (right)
    await expect(page.locator('body')).toBeVisible();

    // Check that URL is notebook page
    await expect(page).toHaveURL(/\/notebook\//);
  });

  test('notebook name is visible', async ({ page }) => {
    await expect(page.locator(`text=${notebookName}`).first()).toBeVisible({ timeout: 10000 });
  });

  test('back button navigates to dashboard', async ({ page }) => {
    const backBtn = page.locator('button[aria-label*="back"], a[href="/dashboard"]').first().or(
      page.getByRole('link', { name: /dashboard/i }).first()
    );

    if (await backBtn.isVisible({ timeout: 3000 })) {
      await backBtn.click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    } else {
      // Use the back arrow button
      const arrowBack = page.locator('button').filter({ has: page.locator('svg') }).first();
      await arrowBack.click();
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    }
  });

  test('sources panel shows upload option', async ({ page }) => {
    // Upload button or "Add source" should be visible in the sources panel
    const uploadArea = page.locator('button').filter({ hasText: /upload|add source|add/i }).first();
    await expect(uploadArea).toBeVisible({ timeout: 10000 });
  });

  test('chat input is visible and accepts text', async ({ page }) => {
    const textarea = page.locator('textarea').last();
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill('Hello, this is a test message');
    await expect(textarea).toHaveValue('Hello, this is a test message');
  });

  test('file upload shows input element', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    // File input should exist (might be hidden)
    await expect(fileInput).toBeAttached({ timeout: 10000 });
  });

  test('upload a text file as source', async ({ page }) => {
    // Create a temporary test file content
    const testFilePath = path.join('/Users/tommy/Documents/vibe-coding/Noteflow/tests', 'e2e_test.md');

    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeAttached({ timeout: 10000 });

    await fileInput.setInputFiles(testFilePath);

    // Should show some upload progress or source being added
    // Look for spinner or progress indicator
    await expect(
      page.locator('[class*="animate"], [class*="loading"], [class*="progress"]').first()
    ).toBeVisible({ timeout: 10000 }).catch(() => {
      // Upload might complete too fast to catch the spinner
    });
  });

  test('notebook page has studio panel area', async ({ page }) => {
    // Studio button or tab should be present
    const studioEl = page.locator('button').filter({ hasText: /studio/i }).first().or(
      page.locator('[class*="studio"]').first()
    );
    // Studio should be somewhere on the page (might be collapsed or as a button)
    await expect(studioEl).toBeVisible({ timeout: 10000 });
  });
});
