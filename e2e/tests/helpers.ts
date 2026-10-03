import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

export const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const PASSWORD = 'Password123!';
export const HOSPITAL_CODE = 'SAOLUCAS';

export async function sql<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}

/** A fresh browser context per person, signed in with e-mail + password. */
export async function signIn(browser: Browser, email: string, password = PASSWORD): Promise<Page> {
  // Tests assert English copy; the demo users mostly prefer pt-BR.
  await sql(`update public.profiles set locale = 'en' where id = (select id from auth.users where email = $1)`, [email]);
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await page.goto('/sign-in');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('sign-in').click();
  await expect(page.getByText('Your queue', { exact: true })).toBeVisible();
  return page;
}

export async function confirmDialog(page: Page) {
  await page.getByTestId('confirm-dialog-confirm').click();
}

/** "#N" and "of M" as shown on the home screen hero. */
export async function expectPosition(page: Page, position: number, total: number) {
  await expect(page.getByTestId('position-number')).toHaveText(`#${position}`);
  await expect(page.getByTestId('position-total')).toHaveText(`of ${total}`);
}

/** People in a profession's queue (waiting + paused), in order, with e-mail and name. */
export async function queueOrder(profession: 'doctor' | 'nurse') {
  return sql<{ email: string; name: string }>(
    `select u.email, p.display_name as name
     from public.queue_entries e
     join public.queues q on q.id = e.queue_id
     join public.organizations o on o.id = q.org_id
     join auth.users u on u.id = e.user_id
     join public.profiles p on p.id = e.user_id
     where o.join_code = $1 and q.profession = $2 and e.closed_at is null and e.status in ('waiting', 'paused')
     order by e.seq`,
    [HOSPITAL_CODE, profession],
  );
}
