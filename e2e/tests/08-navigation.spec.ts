/**
 * E2E Tests: Navigation & routing
 * - 404 page for unknown routes
 * - Privacy policy page
 * - Terms of service page
 * - Forgot password page
 * - Navigation flows
 */
import { test, expect } from '@playwright/test';

test.describe('Navigation & Public Pages', () => {
  test('404 page for unknown route', async ({ page }) => {
    await page.goto('/this-does-not-exist-xyz');
    await expect(page.locator('text=/not found|404/i').first()).toBeVisible({ timeout: 10000 });
  });

  test('privacy policy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('body')).toBeVisible();
    // Should not redirect to login (public page)
    await expect(page).toHaveURL(/\/privacy/);
  });

  test('terms of service page loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/\/terms/);
  });

  test('help center page loads', async ({ page }) => {
    await page.goto('/help');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/\/help/);
  });

  test('forgot password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).toHaveURL(/\/forgot-password/);
  });

  test('forgot password page has email input', async ({ page }) => {
    await page.goto('/forgot-password');
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible({ timeout: 10000 });
  });

  test('404 page has link to dashboard', async ({ page }) => {
    await page.goto('/completely-invalid-route');
    // Should show a link to go back
    const homeLink = page.locator('a[href="/dashboard"]').or(
      page.getByRole('link', { name: /dashboard|home|go back/i }).first()
    );
    await expect(homeLink).toBeVisible({ timeout: 10000 });
  });

  test('login page URL is correct', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
  });

  test('register page URL is correct', async ({ page }) => {
    await page.goto('/register');
    await expect(page).toHaveURL(/\/register/);
  });

  test('page title includes Noteflow branding', async ({ page }) => {
    await page.goto('/login');
    // Either in page title or visible h1
    const titleOrBrand = await page.evaluate(() => {
      return document.title || document.querySelector('h1')?.textContent || '';
    });
    expect(titleOrBrand.toLowerCase()).toContain('noteflow');
  });

  test('invalid join token page renders (auth guard redirects to login)', async ({ page }) => {
    // The /join/:token route requires auth - unauthenticated users should be redirected to login
    await page.goto('/join/invalid-token-xyz-123');
    // Should redirect to login since user is not authenticated
    await expect(page).toHaveURL(/\/login/);
  });
});
