import { expect, test } from '@playwright/test';
import { HOSPITAL_CODE, confirmDialog, expectPosition, queueOrder, signIn, sql } from './helpers';

// Core flow: sign up with the hospital code as a doctor -> join the queue ->
// see "#N of M" -> a manager publishes a 2-slot doctors' shift -> the first 2
// doctors get it under My shifts, everyone else drops by 2 LIVE (no reload),
// nurses are unaffected -> the shift completes -> rejoin at the END.
test('hospital code sign-up, multi-slot assignment, live positions, rejoin at the end', async ({ browser }) => {
  const suffix = Math.random().toString(36).slice(2, 7);
  const unit = `E2E ward ${suffix}`;

  // 1. A new doctor creates an account with the hospital code (pre-filled from the share link).
  const ctx = await browser.newContext({ locale: 'en-US' });
  const newcomer = await ctx.newPage();
  await newcomer.goto(`/sign-up?code=${HOSPITAL_CODE}`);
  await expect(newcomer.getByTestId('hospital-code')).toHaveValue(HOSPITAL_CODE);
  await newcomer.getByTestId('profession-doctor').click();
  await newcomer.getByTestId('name').fill('Dr. Erin Example');
  await newcomer.getByTestId('email').fill(`e2e.${suffix}@example.test`);
  await newcomer.getByTestId('password').fill('Password123!');
  await newcomer.getByTestId('create-account').click();
  await expect(newcomer.getByText('Your queue', { exact: true })).toBeVisible();

  // 2. Not in the queue yet: the big button and the waiting count.
  const before = await queueOrder('doctor');
  await expect(newcomer.getByTestId('waiting-count')).toHaveText(`${before.length} doctors waiting`);
  await newcomer.getByTestId('join-queue').click();
  await expect(newcomer.getByText('Join the doctors\' queue?')).toBeVisible();
  await confirmDialog(newcomer);
  const total = before.length + 1;
  await expectPosition(newcomer, total, total);

  // Others keep watching their screens (no reloads from here on).
  const [first, second, third] = before;
  const thirdPage = await signIn(browser, third.email);
  await expectPosition(thirdPage, 3, total);
  const nurse = await signIn(browser, 'nurse02@demo.fairshift.app');
  const nurses = await queueOrder('nurse');
  await expectPosition(nurse, 2, nurses.length);

  // 3. The manager creates a doctors' shift with 2 slots and publishes it now.
  const manager = await signIn(browser, 'manager@demo.fairshift.app');
  await manager.goto('/admin/shifts/new');
  await manager.getByTestId('profession-doctor').click();
  await manager.getByTestId('shift-unit').fill(unit);
  await manager.getByTestId('slots-more').click();
  await expect(manager.getByTestId('shift-slots')).toHaveText('2');
  await manager.getByTestId('create-shift').click();

  // After publishing, the manager sees who was assigned: the first two, in order.
  await expect(manager.getByTestId('slots-filled')).toHaveText('2/2');
  await expect(manager.getByTestId(`assignee-${first.name}`)).toContainText('#1');
  await expect(manager.getByTestId(`assignee-${second.name}`)).toContainText('#2');

  // 4. Everyone behind moves up by 2, live. Nurses are unaffected.
  await expectPosition(newcomer, total - 2, total - 2);
  await expectPosition(thirdPage, 1, total - 2);
  await expectPosition(nurse, 2, nurses.length);

  // 5. The first two doctors see the shift under My shifts (and on their home screen).
  const firstPage = await signIn(browser, first.email);
  await expect(firstPage.getByTestId('assigned-shift')).toContainText(unit);
  await firstPage.goto('/shifts');
  await expect(firstPage.getByText(unit)).toBeVisible();
  const secondPage = await signIn(browser, second.email);
  await secondPage.goto('/shifts');
  await expect(secondPage.getByText(unit)).toBeVisible();

  // 6. The shift ends (test-only time travel) and the scheduler completes it.
  const [{ id: shiftId, queue_id: queueId }] = await sql<{ id: string; queue_id: string }>(
    `select id, queue_id from public.shifts where unit = $1`,
    [unit],
  );
  await sql(`update public.shifts set starts_at = now() - interval '13 hours', ends_at = now() - interval '1 hour' where id = $1`, [shiftId]);
  await sql(`select private.process_queue($1)`, [queueId]);
  expect((await sql<{ status: string }>(`select status from public.shifts where id = $1`, [shiftId]))[0].status).toBe('completed');

  // 7. The doctor is told they can rejoin, and rejoins at the END.
  await firstPage.goto('/inbox');
  await expect(firstPage.getByText('Your shift is done. Rejoin the queue?')).toBeVisible();
  await firstPage.goto('/');
  await firstPage.getByTestId('join-queue').click();
  await confirmDialog(firstPage);
  await expectPosition(firstPage, total - 1, total - 1);
  await expectPosition(newcomer, total - 2, total - 1);

  // Everything is in the audit log.
  const types = await sql<{ type: string }>(`select type from public.audit_events where shift_id = $1 order by id`, [shiftId]);
  expect(types.map((t) => t.type)).toEqual(
    expect.arrayContaining(['shift.created', 'shift.published', 'shift.assigned', 'shift.filled', 'shift.completed']),
  );
});

test('sign-up is refused without a valid hospital code', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto('/sign-up');
  await page.getByTestId('hospital-code').fill('WRONG234');
  await page.getByTestId('profession-nurse').click();
  await page.getByTestId('name').fill('No Code');
  await page.getByTestId('email').fill(`nocode.${Math.random().toString(36).slice(2, 7)}@example.test`);
  await page.getByTestId('password').fill('Password123!');
  await page.getByTestId('create-account').click();
  await expect(page.getByText("That hospital code isn't valid.", { exact: false })).toBeVisible();
});
