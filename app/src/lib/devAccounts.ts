// Demo accounts from supabase/seed.sql, for the developer account switcher.
// Only enabled in development builds that opt in via EXPO_PUBLIC_DEV_ACCOUNT_SWITCHER=1,
// so the shared demo password never ships in a production bundle's code path.

export const DEV_ACCOUNT_SWITCHER_ENABLED = __DEV__ && process.env.EXPO_PUBLIC_DEV_ACCOUNT_SWITCHER === '1';

export const DEV_PASSWORD = 'Password123!';

export interface DevAccount {
  email: string;
  name: string;
  note?: 'paused' | 'rejoined' | 'not_joined';
}

export interface DevAccountGroup {
  key: 'manager' | 'doctors' | 'nurses';
  accounts: DevAccount[];
}

const pad = (i: number) => String(i).padStart(2, '0');

const DOCTORS = ['Dra. Paula Freitas', 'Dr. Rafael Costa', 'Dra. Sofia Barros', 'Dr. Tiago Moreira', 'Dra. Úrsula Pires',
  'Dr. Vitor Cardoso', 'Dra. Yasmin Duarte', 'Dr. Wagner Lopes', 'Dra. Beatriz Lima', 'Dr. Caio Nogueira'];
const NURSES = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elisa Castro', 'Fábio Nunes',
  'Gabriela Alves', 'Heitor Ramos', 'Isabela Prado', 'João Martins'];

export const DEV_ACCOUNT_GROUPS: DevAccountGroup[] = [
  { key: 'manager', accounts: [{ email: 'manager@demo.fairshift.app', name: 'Gestora (Escala)' }] },
  {
    key: 'doctors',
    accounts: DOCTORS.map((name, i) => ({
      email: `doctor${pad(i + 1)}@demo.fairshift.app`,
      name,
      note: i === 0 ? 'rejoined' : i >= 8 ? 'not_joined' : undefined,
    })),
  },
  {
    key: 'nurses',
    accounts: NURSES.map((name, i) => ({
      email: `nurse${pad(i + 1)}@demo.fairshift.app`,
      name,
      note: i === 4 ? 'paused' : i >= 8 ? 'not_joined' : undefined,
    })),
  },
];
