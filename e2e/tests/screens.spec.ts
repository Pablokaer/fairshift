import { devices, test } from '@playwright/test';
import { HOSPITAL_CODE, signIn } from './helpers';

// Not an assertion-heavy test: captures phone-sized screenshots of the main
// screens (for docs and visual review). Run with SCREENSHOTS_DIR=... to keep them.
const DIR = process.env.SCREENSHOTS_DIR;
test.skip(!DIR, 'set SCREENSHOTS_DIR to capture screenshots');

test('screens', async ({ browser }) => {
  const phone = devices['iPhone 13'].viewport;
  const shot = async (page: import('@playwright/test').Page, name: string) => {
    await page.setViewportSize(phone);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  };

  const anon = await (await browser.newContext({ locale: 'en-US' })).newPage();
  await anon.goto('/sign-in');
  await shot(anon, '01-sign-in');
  await anon.goto(`/sign-up?code=${HOSPITAL_CODE}`);
  await shot(anon, '02-sign-up');

  const notJoined = await signIn(browser, 'doctor09@demo.fairshift.app');
  await shot(notJoined, '10-home-not-joined');
  const inQueue = await signIn(browser, 'nurse03@demo.fairshift.app');
  await shot(inQueue, '11-home-in-queue');
  const paused = await signIn(browser, 'nurse05@demo.fairshift.app');
  await shot(paused, '12-home-unavailable');
  await inQueue.goto('/shifts');
  await shot(inQueue, '13-my-shifts');
  await inQueue.goto('/inbox');
  await shot(inQueue, '14-inbox');
  await inQueue.goto('/settings');
  await shot(inQueue, '15-settings');

  const manager = await signIn(browser, 'manager@demo.fairshift.app');
  await manager.goto('/admin');
  await shot(manager, '20-manager-dashboard');
  await manager.goto('/admin/queue/doctor');
  await shot(manager, '21-live-queue');
  await manager.goto('/admin/professionals');
  await shot(manager, '22-professionals');
  await manager.goto('/admin/shifts/new');
  await shot(manager, '23-new-shift');
  await manager.goto('/admin/shifts');
  await manager.getByTestId('scope-drafts').click();
  await shot(manager, '24-drafts');
  await manager.goto('/admin/audit');
  await shot(manager, '25-audit');
  await manager.goto('/admin/fairness');
  await shot(manager, '26-fairness');
});
