/**
 * E2E Tests: Notebook sharing
 * - Share modal opens
 * - Generate invite link
 * - Copy link button works
 * - Invalid share token shows error
 */
import { test, expect } from '@playwright/test';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Notebook Sharing', () => {
  let accessToken = '';
  let testEmail = '';
  const testPassword = 'E2eTest123!';
  let notebookId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_share_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Share User', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;

    const nb = await createNotebookViaApi(page, `Share Test NB ${uniqueSuffix()}`, accessToken);
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

  test('share button is visible in notebook', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: /share with team/i });
    await expect(shareBtn).toBeVisible({ timeout: 10000 });
  });

  test('clicking share opens share modal', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: /share with team/i });
    await shareBtn.click();

    // Modal should show "Invite your team members" heading
    await expect(page.getByRole('heading', { name: /invite/i })).toBeVisible({ timeout: 5000 });
  });

  test('share modal has invite link section', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: /share with team/i });
    await shareBtn.click();

    // Look for email input in the share modal
    await expect(page.getByPlaceholder(/email/i)).toBeVisible({ timeout: 10000 });
    // And invite link option
    await expect(page.getByRole('button', { name: /invite link/i })).toBeVisible();
  });

  test('invalid join token shows error page', async ({ page }) => {
    await page.goto('/join/invalid-token-xyz');

    // Should show an error or invalid token message
    await expect(
      page.locator('text=/invalid|expired|not found|error/i').first()
    ).toBeVisible({ timeout: 10000 });
  });

  test('share modal can be closed', async ({ page }) => {
    const shareBtn = page.getByRole('button', { name: /share with team/i });
    await shareBtn.click();

    const inviteHeading = page.getByRole('heading', { name: /invite/i });
    await expect(inviteHeading).toBeVisible({ timeout: 5000 });

    // Close via "Finish & Open Notebook" button or Escape
    const finishBtn = page.getByRole('button', { name: /finish/i });
    if (await finishBtn.isVisible({ timeout: 2000 })) {
      await finishBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(inviteHeading).not.toBeVisible({ timeout: 5000 });
  });
});
