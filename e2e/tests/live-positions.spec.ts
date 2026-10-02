import { expect, test } from '@playwright/test';
import { signIn, sql } from './helpers';

// Acceptance: publish a shift as admin, accept it as the first staff member,
// and watch the other users' positions update live (no reload).
test('admin publishes, #1 accepts, everyone else moves up live', async ({ browser }) => {
  await sql(`select 1`); // DB reachable
  const admin = await signIn(browser, 'admin@demo.fairshift.app');
  const nurse1 = await signIn(browser, 'nurse01@demo.fairshift.app');
  const nurse2 = await signIn(browser, 'nurse02@demo.fairshift.app');
  const nurse7 = await signIn(browser, 'nurse07@demo.fairshift.app');

  await expect(nurse2.getByTestId('position-ICU Nurses')).toHaveText('You are #2 of 12');
  await expect(nurse7.getByTestId('position-ICU Nurses')).toHaveText('You are #7 of 12');

  // Admin publishes a draft ICU shift.
  await admin.goto('/admin/shifts');
  await admin.getByText('Drafts', { exact: true }).click();
  await admin.getByTestId('admin-shift-ICU 2').click(); // select
  await admin.getByTestId('publish-selected').click();

  // nurse01 gets the offer live and accepts it.
  await expect(nurse1.getByTestId('view-offer-' + (await queueId('ICU Nurses')))).toBeVisible();
  await nurse1.getByTestId('view-offer-' + (await queueId('ICU Nurses'))).click();
  await expect(nurse1.getByText('Shift offer: ICU Nurses')).toBeVisible();
  await nurse1.getByTestId('accept-offer').click();
  await expect(nurse1.getByText("You accepted this shift. It's yours!")).toBeVisible();

  // Everyone else moved up without reloading.
  await expect(nurse2.getByTestId('position-ICU Nurses')).toHaveText('You are #1 of 11');
  await expect(nurse7.getByTestId('position-ICU Nurses')).toHaveText('You are #6 of 11');

  // The admin's live view shows the assignment.
  await admin.goto('/admin/shifts');
  await admin.getByText('Assigned', { exact: true }).click();
  await expect(admin.getByText('Assigned to Ana Souza')).toBeVisible();
});

async function queueId(name: string) {
  const [row] = await sql<{ id: string }>(`select id from public.queues where name = $1`, [name]);
  return row.id;
}
