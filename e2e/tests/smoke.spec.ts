import { expect, test } from '@playwright/test';

test('home page renders the DealFlow hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('hero-title')).toHaveText('DealFlow');
});
