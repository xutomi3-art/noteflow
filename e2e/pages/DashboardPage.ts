import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

export class DashboardPage {
  readonly page: Page;
  readonly createNotebookButton: Locator;
  readonly notebookNameInput: Locator;
  readonly createConfirmButton: Locator;
  readonly notebookCards: Locator;
  readonly userMenuButton: Locator;
  readonly logoutButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // "New Notebook" button in header or empty state
    this.createNotebookButton = page
      .getByRole('button', { name: /new notebook/i })
      .first();
    this.notebookNameInput = page.locator('input[placeholder*="name"], input[placeholder*="Notebook"]').first();
    this.createConfirmButton = page.getByRole('button', { name: /^create$/i });
    this.notebookCards = page.locator('[class*="rounded"][class*="cursor-pointer"]').filter({ hasText: /ago|Just now/ });
    this.userMenuButton = page.locator('button').filter({ has: page.locator('img[alt]') }).last();
    this.logoutButton = page.getByRole('button', { name: /sign out|log out/i });
  }

  async goto() {
    await this.page.goto('/dashboard');
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/dashboard/);
    // Dashboard header contains user name or Noteflow logo area
    await expect(this.page.locator('body')).toBeVisible();
  }

  async createNotebook(name: string): Promise<string> {
    await this.createNotebookButton.click();

    // Modal should appear with a name input
    const modal = this.page.locator('[class*="modal"], [class*="fixed"][class*="inset"]').last();
    await expect(modal).toBeVisible({ timeout: 5000 });

    const nameInput = this.page.locator('input[type="text"]').last();
    await nameInput.clear();
    await nameInput.fill(name);

    const confirmBtn = this.page.getByRole('button', { name: /^create$/i });
    await confirmBtn.click();

    // Wait for navigation to notebook page
    await this.page.waitForURL(/\/notebook\//, { timeout: 15000 });
    const url = this.page.url();
    const match = url.match(/\/notebook\/([^/?]+)/);
    return match ? match[1] : '';
  }

  async openNotebook(name: string) {
    await this.page.locator('text=' + name).first().click();
    await this.page.waitForURL(/\/notebook\//);
  }

  async deleteNotebook(name: string) {
    const card = this.page.locator('[class*="rounded"]').filter({ hasText: name }).first();
    // Hover to reveal the ... menu
    await card.hover();
    const moreButton = card.locator('button').last();
    await moreButton.click();
    const deleteOption = this.page.getByRole('menuitem', { name: /delete/i }).or(
      this.page.locator('[role="button"]').filter({ hasText: /delete/i })
    ).first();
    await deleteOption.click();
    // Confirm deletion dialog if present
    const confirmDelete = this.page.getByRole('button', { name: /delete/i }).last();
    if (await confirmDelete.isVisible({ timeout: 2000 })) {
      await confirmDelete.click();
    }
  }
}
