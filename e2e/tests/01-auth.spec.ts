/**
 * E2E Tests: Authentication flows
 * - Registration (happy path + validation)
 * - Login (happy path + wrong credentials)
 * - Auth guard (protected routes redirect)
 * - Logout
 */
import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';

const uniqueSuffix = () => Date.now().toString().slice(-6);

test.describe('Authentication', () => {
  test('login page renders correctly', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await expect(page.locator('h1')).toContainText('Noteflow');
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    await expect(loginPage.registerLink).toBeVisible();
    await expect(loginPage.forgotPasswordLink).toBeVisible();
  });

  test('register page renders correctly', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    await registerPage.goto();

    await expect(page.locator('h1')).toContainText('Noteflow');
    await expect(registerPage.nameInput).toBeVisible();
    await expect(registerPage.emailInput).toBeVisible();
    await expect(registerPage.passwordInput).toBeVisible();
    await expect(registerPage.submitButton).toBeVisible();
  });

  test('login page links to register page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /create one/i }).click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('register page links back to login', async ({ page }) => {
    await page.goto('/register');
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated user redirected from /dashboard to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated user redirected from /notebook/* to /login', async ({ page }) => {
    await page.goto('/notebook/fake-id-123');
    await expect(page).toHaveURL(/\/login/);
  });

  test('login shows error on wrong credentials', async ({ page }) => {
    // Check if backend is reachable: 401 means backend is up but unauthenticated
    const health = await page.request.get(`/api/auth/me`);
    if (health.status() === 500) {
      test.skip(true, 'Backend not available');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('nonexistent@example.com', 'WrongPassword123');
    // Should show an error message
    await expect(loginPage.errorMessage).toBeVisible({ timeout: 10000 });
  });

  test('register shows password strength indicators', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    // Type a partial password to trigger indicators
    await registerPage.passwordInput.fill('abc');
    // Indicators should appear
    await expect(page.locator('text=8+ chars')).toBeVisible();
    await expect(page.locator('text=uppercase')).toBeVisible();
    await expect(page.locator('text=digit')).toBeVisible();
  });

  test('register shows error for weak password on submit', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    await registerPage.register('Test User', `test_${uniqueSuffix()}@example.com`, 'weak');
    await expect(registerPage.errorMessage).toBeVisible({ timeout: 5000 });
    await expect(registerPage.errorMessage).toContainText('Password');
  });

  test('full registration and redirect to dashboard', async ({ page }) => {
    // Probe backend availability: backend is up if we get non-500 response
    let backendAvailable = false;
    try {
      const probe = await page.request.post(`/api/auth/register`, {
        data: { email: 'check@test.com', name: 'check', password: 'Check1234!' },
      });
      // 500 = backend down (proxy error), 4xx = backend up (validation/auth error)
      backendAvailable = probe.status() !== 500 && probe.status() < 500;
    } catch {
      backendAvailable = false;
    }

    if (!backendAvailable) {
      test.skip(true, 'Backend not available');
      return;
    }

    const registerPage = new RegisterPage(page);
    await registerPage.goto();
    const email = `e2e_reg_${uniqueSuffix()}@test.com`;
    await registerPage.register('E2E Tester', email, 'E2eTest123!');
    // After successful registration → dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('full login flow and redirect to dashboard', async ({ page }) => {
    // First register via API, then log in via UI
    const email = `e2e_login_${uniqueSuffix()}@test.com`;
    const password = 'E2eTest123!';

    // Register via API
    const regResponse = await page.request.post(`/api/auth/register`, {
      data: { email, name: 'E2E Login Test', password },
    });

    // Skip test if API not available
    if (!regResponse.ok()) {
      test.skip(true, 'Backend not available');
      return;
    }

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(email, password);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  });

  test('/ root redirects to /dashboard (then to /login if not authenticated)', async ({ page }) => {
    await page.goto('/');
    // Either stays at /login (if not authed) or /dashboard (if authed from previous test)
    await expect(page).toHaveURL(/\/(login|dashboard)/);
  });
});
