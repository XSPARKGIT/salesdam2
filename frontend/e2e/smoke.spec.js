import { test, expect } from '@playwright/test';

test('login page renders with content', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e-screenshot-login.png', fullPage: true });
  const bodyText = await page.textContent('body');
  expect(bodyText).toContain('Salesdam');
  expect(bodyText).toContain('Sign in');
  console.log('Login page OK - content verified');
});

test('admin settings page renders', async ({ page }) => {
  await page.goto('/admin/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'e2e-screenshot-admin-settings.png', fullPage: true });
  console.log('Admin settings page screenshot taken');
});
