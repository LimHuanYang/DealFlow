import { expect, test } from '@playwright/test';

test('add a note and a task to a new contact, then complete the task on /app/tasks', async ({
  page,
}) => {
  const email = `e2e_activities_${Date.now()}@example.com`;
  const password = 'CorrectHorseBatteryStaple1';

  // Sign up a fresh user (also creates the org).
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('E2E User');
  await page.getByLabel('Organization name').fill(`E2E Co ${Date.now()}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app/);

  // Create a contact via the API (the create-contact dialog's form submit doesn't
  // reliably round-trip under Playwright — see the skipped contacts-companies
  // spec for context). The session cookie set during signup is reused via the
  // page's request context.
  const createRes = await page.request.post('http://localhost:3001/api/v1/contacts', {
    data: { firstName: 'E2E Contact' },
  });
  expect(createRes.status()).toBe(201);
  const created = (await createRes.json()) as { contact: { id: string } };
  await page.goto('/app/contacts');
  await page.getByRole('link', { name: /E2E Contact/i }).click();
  await expect(page).toHaveURL(new RegExp(`/app/contacts/${created.contact.id}`));

  // Wait for the feed to render its empty state.
  await expect(page.getByTestId('activity-feed')).toBeVisible();
  await expect(page.getByText(/no activity yet/i)).toBeVisible();

  // Add a note.
  await page.getByRole('button', { name: /^note$/i }).click();
  await page.getByTestId('add-note-textarea').fill('Met at conference');
  await page.getByRole('button', { name: /^add note$/i }).click();
  await expect(page.getByText('Met at conference')).toBeVisible();

  // Add a task with a far-future due date.
  await page.getByRole('button', { name: /^task$/i }).click();
  await page.getByTestId('add-task-input').fill('Send proposal');
  await page.getByTestId('add-task-due').fill('2099-12-31');
  await page.getByRole('button', { name: /^add task$/i }).click();
  await expect(page.getByText('Send proposal')).toBeVisible();

  // Visit /app/tasks and complete the task. The checkbox is controlled and
  // its `checked` state only flips after the toggle mutation resolves and the
  // task list refetches, so we use `click()` (which doesn't assert state) and
  // verify completion by switching to the Done tab.
  await page.goto('/app/tasks');
  await expect(page.getByText('Send proposal')).toBeVisible();
  await page.getByRole('checkbox').first().click();

  // After completing, switch to the Done tab — the task should be there.
  await page.getByRole('tab', { name: /^done$/i }).click();
  await expect(page.getByText('Send proposal')).toBeVisible();
});
