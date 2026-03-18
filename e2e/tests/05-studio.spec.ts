/**
 * E2E Tests: Studio features
 * - Studio panel renders
 * - Summary button visible
 * - FAQ button visible
 * - Study Guide button visible
 * - Saved Notes section visible
 */
import { test, expect } from '@playwright/test';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Studio Features', () => {
  let accessToken = '';
  let testEmail = '';
  const testPassword = 'E2eTest123!';
  let notebookId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_studio_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Studio User', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;

    const nb = await createNotebookViaApi(page, `Studio Test NB ${uniqueSuffix()}`, accessToken);
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

  test('studio panel or button is visible', async ({ page }) => {
    // Studio might be a right panel or a button/tab
    const studioBtn = page.locator('button').filter({ hasText: /studio/i }).first();
    const studioPanel = page.locator('[class*="studio"]').first();

    const isVisible = await studioBtn.isVisible({ timeout: 5000 })
      .catch(() => false) || await studioPanel.isVisible({ timeout: 5000 }).catch(() => false);

    expect(isVisible).toBeTruthy();
  });

  test('summary button or option is present', async ({ page }) => {
    // Summary could be in Studio panel
    const summaryEl = page.locator('button, [role="button"]').filter({ hasText: /summary/i }).first();
    await expect(summaryEl).toBeVisible({ timeout: 10000 });
  });

  test('FAQ option is present', async ({ page }) => {
    const faqEl = page.locator('button, [role="button"]').filter({ hasText: /faq/i }).first();
    await expect(faqEl).toBeVisible({ timeout: 10000 });
  });

  test('study guide option is present', async ({ page }) => {
    const studyEl = page.locator('button, [role="button"]').filter({ hasText: /study guide/i }).first();
    await expect(studyEl).toBeVisible({ timeout: 10000 });
  });

  test('saved notes section is present', async ({ page }) => {
    const savedNotesEl = page.locator('text=/saved notes/i').first();
    await expect(savedNotesEl).toBeVisible({ timeout: 10000 });
  });

  test('mind map option is present', async ({ page }) => {
    const mindMapEl = page.locator('button, [role="button"]').filter({ hasText: /mind map/i }).first();
    await expect(mindMapEl).toBeVisible({ timeout: 10000 });
  });

  test('clicking summary shows generate button or starts generation', async ({ page }) => {
    const summaryBtn = page.locator('button').filter({ hasText: /summary/i }).first();
    await summaryBtn.click();

    // Should show generate button or loading state
    const generateBtn = page.locator('button').filter({ hasText: /generate|regenerate/i }).first();
    const loadingSpinner = page.locator('[class*="animate-spin"]').first();

    const hasGenerate = await generateBtn.isVisible({ timeout: 5000 }).catch(() => false);
    const hasLoading = await loadingSpinner.isVisible({ timeout: 5000 }).catch(() => false);

    // Either should be true - studio responded to click
    expect(hasGenerate || hasLoading).toBeTruthy();
  });
});
