// Web session storage: the browser's localStorage (guarded for non-browser contexts).
const hasWindow = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export const authStorage = {
  getItem: (key: string) => (hasWindow ? window.localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (hasWindow) window.localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (hasWindow) window.localStorage.removeItem(key);
  },
};
