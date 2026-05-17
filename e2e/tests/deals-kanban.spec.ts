import { expect, test } from '@playwright/test';

test('signup, create deal, navigate to detail', async ({ page }) => {
  const email = `e2e_deals_${Date.now()}@example.com`;

  // Signup (auto-seeds default pipeline).
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E Deals');
  await page.getByLabel('Organization name').fill('E2E DealsCo');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('CorrectHorseBatteryStaple1');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app/);

  // Navigate to kanban
  await page.goto('/app/deals');
  await expect(page.getByText('Sales', { exact: false })).toBeVisible();

  // Create a deal in the Lead column via the "New deal" button
  await page.getByRole('button', { name: 'New deal' }).click();
  await page.getByLabel('Name').fill('Acme Deal');
  await page.getByRole('button', { name: /create deal/i }).click();

  // Verify the card appears
  const card = page.getByRole('link', { name: 'Acme Deal' });
  await expect(card).toBeVisible();

  // Click into detail page
  await card.click();
  await expect(page).toHaveURL(/\/app\/deals\//);
  await expect(page.getByTestId('deal-name')).toContainText('Acme Deal');
});
