import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import * as path from 'path';

export class NotebookPage {
  readonly page: Page;
  readonly chatInput: Locator;
  readonly sendButton: Locator;
  readonly sourcesPanel: Locator;
  readonly uploadButton: Locator;
  readonly studioTab: Locator;
  readonly chatTab: Locator;
  readonly sourcesTab: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chatInput = page.locator('textarea, input[placeholder*="Ask"], input[placeholder*="ask"], input[placeholder*="Message"]').last();
    this.sendButton = page.locator('button[type="submit"]').last();
    this.sourcesPanel = page.locator('[class*="sources"], [class*="Sources"]').first();
    this.uploadButton = page.getByRole('button', { name: /upload|add source/i }).first();
    this.studioTab = page.getByRole('button', { name: /studio/i }).first();
    this.chatTab = page.getByRole('button', { name: /chat/i }).first();
    this.sourcesTab = page.getByRole('button', { name: /sources/i }).first();
  }

  async goto(notebookId: string) {
    await this.page.goto(`/notebook/${notebookId}`);
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/\/notebook\//);
  }

  async sendMessage(message: string) {
    // Find the chat input - it's likely in the center panel
    const textarea = this.page.locator('textarea').last();
    await textarea.fill(message);
    await textarea.press('Enter');
  }

  async waitForResponse() {
    // Wait for streaming to finish - look for response text appearing
    await this.page.waitForFunction(() => {
      const stopButton = document.querySelector('button[title*="stop"], button[aria-label*="stop"]');
      return !stopButton;
    }, { timeout: 60000 }).catch(() => {
      // If stop button never appeared, response was already done
    });
    // Give a moment for final render
    await this.page.waitForTimeout(1000);
  }

  async uploadFile(filePath: string) {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
  }

  async clickUploadTrigger() {
    // Click the upload button to open file dialog or upload area
    const uploadBtn = this.page.locator('button').filter({ hasText: /upload|add/i }).first();
    await uploadBtn.click();
  }

  async getSourceCount(): Promise<number> {
    const sourceItems = this.page.locator('[class*="source-item"], [class*="sourceItem"]');
    return sourceItems.count();
  }

  async clickStudio() {
    const studioBtn = this.page.locator('button').filter({ hasText: /studio/i }).first();
    await studioBtn.click();
  }

  async generateSummary() {
    const summaryBtn = this.page.locator('button').filter({ hasText: /summary/i }).first();
    await summaryBtn.click();
  }
}
