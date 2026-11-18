/**
 * LLM settings of this browser tab. The API key lives only in memory (it is
 * never written to storage, the URL, or the shared document).
 */
import { create } from 'zustand';
import type { LLMProviderId, ServerConfig } from '../../shared/types';

interface SettingsState {
  provider: LLMProviderId;
  model: string;
  apiKey: string;
  serverConfig: ServerConfig | null;
  setProvider: (p: LLMProviderId) => void;
  setModel: (m: string) => void;
  setApiKey: (k: string) => void;
  setServerConfig: (c: ServerConfig | null) => void;
}

export const useSettings = create<SettingsState>()((set) => ({
  provider: 'mock',
  model: 'gpt-4o',
  apiKey: '',
  serverConfig: null,
  setProvider: (provider) => set({ provider }),
  setModel: (model) => set({ model }),
  setApiKey: (apiKey) => set({ apiKey }),
  setServerConfig: (serverConfig) => set({ serverConfig }),
}));
