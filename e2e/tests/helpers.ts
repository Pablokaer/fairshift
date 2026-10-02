import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';

export const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
export const PASSWORD = 'Password123!';

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
  await expect(page.getByText('Your queues')).toBeVisible();
  return page;
}

export async function confirmDialog(page: Page) {
  await page.getByTestId('confirm-dialog-confirm').click();
}
