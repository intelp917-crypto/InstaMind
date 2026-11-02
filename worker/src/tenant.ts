import type { TenantSettings } from './types';
import { defaultGuardrails, defaultPersona, normalizeTenantSettings } from './settings';

export function defaultTenantSettings(): TenantSettings {
  return {
    persona: defaultPersona(),
    guardrails: defaultGuardrails(),
    knowledge: []
  };
}

export function parseTenantSettings(json: string): TenantSettings {
  try {
    const parsed = JSON.parse(json || '{}');
    return normalizeTenantSettings(parsed);
  } catch {
    return defaultTenantSettings();
  }
}
