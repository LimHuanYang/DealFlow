import { expect, test } from '@playwright/test';

test('signup, see /app, sign out, back to /login', async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;

  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E User');
  await page.getByLabel('Organization name').fill('E2E Org');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTestId('welcome')).toContainText('E2E User');

  await page.getByRole('button', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
});
