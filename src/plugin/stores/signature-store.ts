import type { SignatureStore, SignedThinking } from '../core/streaming/types';

export function createSignatureStore(): SignatureStore {
  const store = new Map<string, SignedThinking>();

  return {
    get: (key: string) => store.get(key),
    set: (key: string, value: SignedThinking) => {
      store.set(key, value);
    },
    has: (key: string) => store.has(key),
    delete: (key: string) => {
      store.delete(key);
    },
  };
}

export const defaultSignatureStore = createSignatureStore();
