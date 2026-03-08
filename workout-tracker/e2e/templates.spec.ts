import { test, expect } from '@playwright/test';

/**
 * TDD Loop 2: Template management E2E tests.
 */

test.describe('Template Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#app');
    await page.click('.nav-btn[data-route="templates"]');
    await page.waitForSelector('.templates-screen');
  });

  test('shows the templates screen with title', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Templates');
  });

  test('displays the default 5/3/1 BBB template', async ({ page }) => {
    const list = page.locator('[data-testid="template-list"]');
    await expect(list).toBeVisible();
    await expect(list.locator('.template-card')).toHaveCount(1);
    await expect(list.locator('.template-card h3')).toContainText('5/3/1');
  });

  test('has edit button for existing templates', async ({ page }) => {
    const editBtn = page.locator('.edit-template-btn');
    await expect(editBtn).toHaveCount(1);
  });

  test('navigates to template editor when edit is clicked', async ({ page }) => {
    await page.click('.edit-template-btn');
    await expect(page.locator('h1')).toHaveText('Edit Template');
  });

  test('template editor shows template name input', async ({ page }) => {
    await page.click('.edit-template-btn');

    const nameInput = page.locator('[data-testid="template-name-input"]');
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toHaveValue('5/3/1 Boring But Big');
  });

  test('template editor shows exercise dropdowns', async ({ page }) => {
    await page.click('.edit-template-btn');

    const mainLiftSelect = page.locator('[data-testid="main-lift-select-0-0"]');
    await expect(mainLiftSelect).toBeVisible();
  });

  test('can modify template name and save', async ({ page }) => {
    await page.click('.edit-template-btn');

    const nameInput = page.locator('[data-testid="template-name-input"]');
    await nameInput.fill('My Custom 5/3/1');

    await page.click('[data-testid="save-template-btn"]');

    // Should navigate back to templates list
    await expect(page.locator('h1')).toHaveText('Templates');
    // Template should have new name
    await expect(page.locator('.template-card h3')).toContainText('My Custom 5/3/1');
  });

  test('has a create new template button', async ({ page }) => {
    const addBtn = page.locator('#add-template-btn');
    await expect(addBtn).toBeVisible();
    await expect(addBtn).toHaveText('Create New Template');
  });

  test('create new template button navigates to template editor', async ({ page }) => {
    await page.locator('#add-template-btn').click();
    await expect(page.locator('h1')).toHaveText('Edit Template');
  });

  test('visual snapshot of templates screen', async ({ page }) => {
    // Wait for template list to be fully rendered
    await expect(page.locator('[data-testid="template-list"]')).toBeVisible();
    await expect(page).toHaveScreenshot('templates-screen.png', {
      maxDiffPixelRatio: 0.05,
    });
  });

  test('each template card has a delete button', async ({ page }) => {
    const deleteBtn = page.locator('.delete-template-btn');
    await expect(deleteBtn).toHaveCount(1);
  });

  test('deleting a template removes it from the list', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('.delete-template-btn');
    await expect(page.locator('.template-card')).toHaveCount(0);
  });

  test('deleting the last template shows the empty state', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await page.click('.delete-template-btn');
    await expect(page.locator('.templates-empty')).toBeVisible();
    await expect(page.locator('.templates-empty')).toContainText('No templates');
  });

  test('cancelling deletion keeps the template', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.dismiss());
    await page.click('.delete-template-btn');
    await expect(page.locator('.template-card')).toHaveCount(1);
  });
});
