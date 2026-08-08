import { test, expect } from '@playwright/test';

async function openReader(page) {
  await page.goto('/');
  await expect(page.locator('.project-card-rich')).toHaveCount(2, { timeout: 20000 });
  const moon = page.locator('.project-card-rich').filter({ hasText: 'Лунная клятва' });
  await moon.getByRole('button', { name: /Продолжить|Открыть/ }).click();
  await expect(page.locator('#readerShell')).toBeVisible();
}

for (const vp of [{ width: 320, height: 568 }, { width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
  test(`mobile reader ${vp.width}x${vp.height}`, async ({ page }) => {
    await page.setViewportSize(vp);
    await openReader(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    for (let i = 0; i < 5; i++) {
      const gap = await page.evaluate(() => {
        const c = document.querySelector('.current-frame')?.getBoundingClientRect();
        const f = document.querySelector('.reader-bottom-mobile')?.getBoundingClientRect();
        return c && f ? Math.round(f.top - c.bottom) : 999;
      });
      expect(Math.abs(gap - 8)).toBeLessThanOrEqual(3);
      await page.locator('[data-reader-action="forward"]').last().click();
      await page.waitForTimeout(80);
    }
  });
}

test('desktop context is not clipped', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReader(page);
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.reader-context-zone .context-frame')].some(el => el.scrollHeight > el.clientHeight + 2 || getComputedStyle(el).overflow === 'hidden'));
  expect(clipped).toBeFalsy();
});

test('reader sidebar uses nested chapter and scene-family hierarchy', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openReader(page);
  await expect(page.locator('.scene-tree .reader-chapter-group')).toHaveCount(12);
  const openChapters = page.locator('.scene-tree .reader-chapter-group[open]');
  await expect(openChapters).toHaveCount(1);
  const chapterOne = page.locator('.scene-tree .reader-chapter-group').first();
  await expect(chapterOne.locator('.scene-family')).not.toHaveCount(0);
  const nestedFamily = chapterOne.locator('.scene-family').filter({ hasText: '1.2' }).first();
  await nestedFamily.locator('summary').click();
  await expect(nestedFamily.locator('[data-scene-id]')).toHaveCount(2);
});

test('mobile navigation has five primary destinations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.mobile-nav .nav-button')).toHaveCount(5);
});
