import { supabase } from './supabase';

// Offset between the server clock and this device (server - device), in ms.
// Countdowns use server time so they hit zero when the server expires the offer.
let offsetMs = 0;
let lastSync = 0;

export async function syncServerClock(force = false): Promise<number> {
  if (!force && Date.now() - lastSync < 60_000) return offsetMs;
  const t0 = Date.now();
  const { data, error } = await supabase.rpc('server_time');
  const t1 = Date.now();
  if (!error && data) {
    const server = new Date(data as unknown as string).getTime();
    offsetMs = server - (t0 + (t1 - t0) / 2);
    lastSync = t1;
  }
  return offsetMs;
}

export const serverNow = () => Date.now() + offsetMs;
