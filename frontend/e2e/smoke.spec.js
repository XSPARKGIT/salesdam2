import { test, expect } from '@playwright/test';

test('login and navigate to call centre', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // Fill login form
  const usernameInput = page.locator('input[name="username"]').first();
  await usernameInput.fill('admin@example.com');
  const passwordInput = page.locator('input[type="password"]').first();
  await passwordInput.fill('Admin@123456');
  
  // Submit
  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'e2e-screenshot-after-login.png', fullPage: true });
  
  // Navigate to call centre
  await page.goto('/admin/call-centre');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'e2e-screenshot-call-centre.png', fullPage: true });
  
  const bodyText = await page.textContent('body');
  console.log('Call centre page text preview:', bodyText?.substring(0, 300));
  console.log('Screenshots saved');
});
