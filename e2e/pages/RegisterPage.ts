import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class RegisterPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly loginLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.locator('#name');
    this.emailInput = page.locator('#email');
    this.passwordInput = page.locator('#password');
    this.submitButton = page.getByRole('button', { name: /create account/i });
    this.errorMessage = page.locator('.text-red-600');
    this.loginLink = page.getByRole('link', { name: /sign in/i });
  }

  async goto() {
    await this.page.goto('/register');
    await expect(this.page.locator('h1')).toContainText('Noteflow');
  }

  async register(name: string, email: string, password: string) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async expectPasswordIndicator(label: string, valid: boolean) {
    const indicator = this.page.locator('span').filter({ hasText: label }).first();
    await expect(indicator).toBeVisible();
    if (valid) {
      await expect(indicator).toContainText('✓');
    } else {
      await expect(indicator).toContainText('○');
    }
  }
}
