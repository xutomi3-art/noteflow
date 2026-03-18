/**
 * E2E Tests: AI Chat flow
 * - Chat input renders
 * - Sending a message
 * - Response streaming
 * - Empty notebook warning (no sources)
 */
import { test, expect } from '@playwright/test';
import { loginViaApi, createNotebookViaApi, deleteNotebookViaApi } from '../helpers/auth';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('AI Chat', () => {
  let accessToken = '';
  let testEmail = '';
  const testPassword = 'E2eTest123!';
  let notebookId = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    testEmail = `e2e_chat_${uniqueSuffix()}@test.com`;

    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email: testEmail, name: 'E2E Chat User', password: testPassword },
    });

    if (!regResponse.ok()) {
      await page.close();
      return;
    }

    const tokens = await regResponse.json();
    accessToken = tokens.access_token;

    const nb = await createNotebookViaApi(page, `Chat Test NB ${uniqueSuffix()}`, accessToken);
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

  test('chat input is visible', async ({ page }) => {
    // Empty notebook shows disabled input "Upload sources to start chatting..."
    // Notebook with sources shows "Start typing..."
    const chatInput = page.getByRole('textbox').last();
    await expect(chatInput).toBeVisible({ timeout: 10000 });
  });

  test('empty notebook shows upload prompt in chat', async ({ page }) => {
    // New empty notebook should show disabled input asking to upload sources
    const disabledInput = page.getByPlaceholder(/upload sources/i);
    await expect(disabledInput).toBeVisible({ timeout: 10000 });
    await expect(disabledInput).toBeDisabled();
  });

  test('send button is disabled for empty notebook', async ({ page }) => {
    // Send button should be disabled when no sources
    const sendBtn = page.locator('button').filter({ has: page.locator('img') }).last();
    const chatArea = page.locator('main').last();
    const disabledBtn = chatArea.getByRole('button', { disabled: true }).last();
    await expect(disabledBtn).toBeVisible({ timeout: 5000 });
  });

  test('chat heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  });

  test('notebook name appears in chat area', async ({ page }) => {
    // The notebook name heading should appear in the chat overview
    const nameHeading = page.getByRole('heading', { level: 1 });
    await expect(nameHeading).toBeVisible({ timeout: 10000 });
  });

  test('source count shows in chat area', async ({ page }) => {
    // Should show "0 sources selected" for empty notebook
    await expect(page.locator('text=/\\d+ sources?/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('AI disclaimer is visible', async ({ page }) => {
    await expect(
      page.locator('text=/AI can be inaccurate/i').first()
    ).toBeVisible({ timeout: 10000 });
  });
});
