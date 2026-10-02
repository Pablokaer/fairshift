import { devices, expect, test } from '@playwright/test';
import { signIn, sql } from './helpers';

// Not an assertion-heavy test: captures phone-sized screenshots of the main
// screens (for docs and visual review). Run with SCREENSHOTS_DIR=... to keep them.
const DIR = process.env.SCREENSHOTS_DIR;
test.skip(!DIR, 'set SCREENSHOTS_DIR to capture screenshots');

test.use({ ...devices['iPhone 13'], browserName: 'chromium' });

test('screens', async ({ browser }) => {
  const shot = async (page: import('@playwright/test').Page, name: string) => {
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  };
  const phone = { ...devices['iPhone 13'] };
  const ctx = await browser.newContext({ ...phone, locale: 'en-US' });
  const p = await ctx.newPage();
  await p.goto('/sign-in');
  await shot(p, '01-sign-in');

  const admin = await signIn(browser, 'admin@demo.fairshift.app');
  await admin.setViewportSize(phone.viewport);
  await admin.goto('/admin');
  await shot(admin, '10-admin-home');
  await admin.goto('/admin/shifts');
  await admin.getByText('Drafts', { exact: true }).click();
  await shot(admin, '11-admin-drafts');
  await admin.getByTestId('admin-shift-ICU 2').click();
  await admin.getByTestId('publish-selected').click();
  await admin.getByText('Open', { exact: true }).click();
  await shot(admin, '12-admin-open-shifts');

  const n1 = await signIn(browser, 'nurse01@demo.fairshift.app');
  await n1.setViewportSize(phone.viewport);
  await expect(n1.getByText('View offer')).toBeVisible();
  await shot(n1, '20-staff-home-offer');
  await n1.getByText('View offer').click();
  await expect(n1.getByRole('timer')).toBeVisible();
  await shot(n1, '21-offer');

  const n3 = await signIn(browser, 'nurse03@demo.fairshift.app');
  await n3.setViewportSize(phone.viewport);
  await shot(n3, '30-staff-home');
  const [{ id: icu }] = await sql<{ id: string }>(`select id from public.queues where name = 'ICU Nurses'`);
  await n3.goto(`/queue/${icu}`);
  await shot(n3, '31-queue-detail');
  await n3.getByText('Leave queue').click();
  await shot(n3, '32-leave-confirm');

  await admin.goto(`/admin/queues/${icu}`);
  await shot(admin, '13-admin-live-queue');
  await admin.goto('/admin/audit');
  await shot(admin, '14-audit');
  await admin.goto('/admin/fairness');
  await shot(admin, '15-fairness');
  await admin.goto('/admin/shifts/new');
  await shot(admin, '16-new-shift');
  await admin.goto('/settings');
  await shot(admin, '17-settings');
  await n3.goto('/inbox');
  await shot(n3, '33-inbox');
});
