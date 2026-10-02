import { expect, test } from '@playwright/test';
import { confirmDialog, signIn, sql } from './helpers';

// Core flow: invite -> join -> offer -> accept -> complete -> rejoin at the END.
test('invite, join, offer, accept, complete, rejoin at the end', async ({ browser }) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const queueName = `E2E Queue ${suffix}`;
  const newEmail = `e2e.${suffix}@example.test`;

  // 1. Admin creates a queue.
  const admin = await signIn(browser, 'admin@demo.fairshift.app');
  await admin.goto('/admin/queues/new');
  await admin.getByTestId('queue-name').fill(queueName);
  await admin.getByTestId('create-queue').click();
  await expect(admin.getByText('Live', { exact: true })).toBeVisible();

  // 2. Admin creates an invite code that grants this queue's pool.
  await admin.goto('/admin/staff');
  await admin.getByRole('tab', { name: 'Invite code' }).click();
  await admin.getByRole('checkbox', { name: queueName }).click();
  await admin.getByTestId('create-invite').click();
  const code = (await admin.getByTestId('invite-token').innerText()).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);

  // 3. A new person signs up and joins the organization with the code.
  const ctx = await browser.newContext({ locale: 'en-US' });
  const nurse = await ctx.newPage();
  await nurse.goto('/sign-up');
  await nurse.getByTestId('name').fill('Erin Example');
  await nurse.getByTestId('email').fill(newEmail);
  await nurse.getByTestId('password').fill('Password123!');
  await nurse.getByTestId('create-account').click();
  await nurse.getByTestId('invite-code').fill(code);
  await nurse.getByTestId('join-org').click();
  await expect(nurse.getByText('Your queues')).toBeVisible();

  // ...and joins the queue.
  await nurse.getByTestId(`join-${queueName}`).click();
  await expect(nurse.getByText(`Join ${queueName}?`)).toBeVisible();
  await confirmDialog(nurse);
  await expect(nurse.getByTestId(`position-${queueName}`)).toHaveText('You are #1 of 1');

  // A colleague (seeded nurse02) is added to the pool and joins behind.
  const [{ id: queueId }] = await sql<{ id: string }>(`select id from public.queues where name = $1`, [queueName]);
  await admin.goto(`/admin/queues/${queueId}`);
  await admin.getByRole('tab', { name: 'Pool' }).click();
  await admin.getByTestId('pool-add-Bruno Lima').click();
  const colleague = await signIn(browser, 'nurse02@demo.fairshift.app');
  await colleague.getByTestId(`join-${queueName}`).click();
  await confirmDialog(colleague);
  await expect(colleague.getByTestId(`position-${queueName}`)).toHaveText('You are #2 of 2');

  // 4. Admin creates and publishes a shift for tomorrow.
  await admin.goto('/admin/shifts/new');
  await admin.getByRole('checkbox', { name: queueName }).click();
  await admin.getByTestId('shift-unit').fill(`Unit ${suffix}`);
  await admin.getByTestId('create-shifts').click();
  await expect(admin.getByText(`Unit ${suffix}`)).toBeVisible();

  // 5. The first person gets the offer (live) and accepts it.
  await nurse.getByTestId(`view-offer-${queueId}`).click();
  await expect(nurse.getByText(`Shift offer: ${queueName}`)).toBeVisible();
  await expect(nurse.getByRole('timer')).toBeVisible();
  await nurse.getByTestId('accept-offer').click();
  await expect(nurse.getByText("You accepted this shift. It's yours!")).toBeVisible();
  await expect(colleague.getByTestId(`position-${queueName}`)).toHaveText('You are #1 of 1');

  // 6. Time travel (test only): the shift is now in progress.
  await sql(
    `update public.shifts set starts_at = now() - interval '6 hours', ends_at = now() + interval '1 hour'
     where queue_id = $1 and unit = $2`,
    [queueId, `Unit ${suffix}`],
  );

  // 7. Admin marks it completed.
  await admin.goto('/admin/shifts');
  await admin.getByText('Assigned', { exact: true }).click();
  await admin.getByTestId(`admin-shift-Unit ${suffix}`).click();
  await admin.getByTestId('complete-shift').click();
  await confirmDialog(admin);
  await expect(admin.getByText('Completed', { exact: true })).toBeVisible();

  // 8. The person is told they can rejoin, and rejoins at the END.
  await nurse.goto('/inbox');
  await expect(nurse.getByText('Your shift is done. Rejoin the queue?')).toBeVisible();
  await nurse.goto('/');
  await nurse.getByTestId(`join-${queueName}`).click();
  await confirmDialog(nurse);
  await expect(nurse.getByTestId(`position-${queueName}`)).toHaveText('You are #2 of 2');

  // Everything is in the audit log.
  const types = await sql<{ type: string }>(`select type from public.audit_events where queue_id = $1 order by id`, [queueId]);
  expect(types.map((t) => t.type)).toEqual(
    expect.arrayContaining(['queue.created', 'entry.joined', 'offer.created', 'offer.accepted', 'shift.assigned', 'shift.completed']),
  );
});
