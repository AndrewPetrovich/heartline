import { test, expect } from '@playwright/test';

test('rich library cards expose structural metrics', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.project-card-rich')).toHaveCount(2, { timeout: 20000 });
  const first = page.locator('.project-card-rich').first();
  await expect(first.getByText('Кадры')).toBeVisible();
  await expect(first.getByText('Выборы')).toBeVisible();
  await expect(first.getByText('Концовки')).toBeVisible();
  await expect(first.getByText('Ветвления')).toBeVisible();
  await expect(first.getByText('Слов в сценарии')).toBeVisible();
  await expect(first.getByText('Уникальный контент')).toBeVisible();
});

test('wide desktop library reserves four equal card columns', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/');
  await expect(page.locator('.project-card-rich')).toHaveCount(2, { timeout: 20000 });
  const grid = await page.locator('.rich-project-list').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean));
  expect(grid).toHaveLength(4);
  const widths = grid.map(value => parseFloat(value));
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
});

test('library card menu is available and cover input exists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#coverInput')).toHaveCount(1);
  const menu = page.locator('[data-project-menu]').first();
  await menu.click();
  await expect(page.getByRole('button', { name: 'Заменить обложку' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Экспорт Project ZIP' })).toBeVisible();
});

test('mobile library has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.project-card-rich')).toHaveCount(2, { timeout: 20000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
