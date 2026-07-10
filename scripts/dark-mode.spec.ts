import { test } from '@playwright/test';

test('theme toggle switches and persists the document theme', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173');

  const toggle = page.locator('button[role="switch"]');
  const toggleCount = await toggle.count();
  if (toggleCount !== 1) {
    throw new Error(`Expected one theme toggle, found ${toggleCount}.`);
  }

  const before = await page.evaluate(() => ({
    isDark: document.documentElement.classList.contains('dark'),
    label: document.querySelector('button[role="switch"]')?.getAttribute('aria-label'),
  }));

  await toggle.click();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => ({
    isDark: document.documentElement.classList.contains('dark'),
    label: document.querySelector('button[role="switch"]')?.getAttribute('aria-label'),
    storedTheme: window.localStorage.getItem('theme'),
  }));

  if (after.isDark === before.isDark) {
    throw new Error('Theme toggle did not change the document dark class.');
  }

  if (after.label === before.label) {
    throw new Error('Theme toggle accessible label did not update.');
  }

  if (after.storedTheme !== (after.isDark ? 'dark' : 'light')) {
    throw new Error(`Theme was not persisted correctly: ${after.storedTheme}.`);
  }
});
