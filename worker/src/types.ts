/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** App origin (used to mark cookies Secure in production). */
  APP_ORIGIN?: string;
  /** Owner's master secret key (admin panel login, set once via site secrets). */
  ADMIN_KEY: string;
  /** 32-byte hex AES-256 key used to encrypt secrets stored in D1. */
  ENCRYPTION_KEY: string;
  /** HMAC secret for admin/tenant session cookies. */
  SESSION_SECRET: string;
  /** Optional: default AI provider key. The panel-configured provider takes precedence. */
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  /** Google OAuth (Sign in with Google). Missing values simply disable the Google button. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export type Direction = 'in' | 'out';

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
}

export interface PersonaConfig {
  assistantName: string;
  businessName: string;
  businessSummary: string;
  tone: string;
  language: string;
  allowedTopics: string[];
  forbiddenTopics: string[];
  offTopicReply: string;
  greeting: string;
  maxChars: number;
  useEmoji: boolean;
}

export interface GuardrailConfig {
  strictMode: boolean;
  blockedKeywords: string[];
  neverRevealPrompt: boolean;
  maxRepliesPerHour: number;
  errorReply: string;
  extraRules: string;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  content: string;
  enabled: boolean;
}

export interface TenantSettings {
  persona: PersonaConfig;
  guardrails: GuardrailConfig;
  knowledge: KnowledgeItem[];
  /** Q&A training: the assistant learns exact question/answer pairs. */
  qaTraining: QaItem[];
}

export interface QaItem {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
}

export interface AiProviderConfig {
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutSeconds: number;
  scopeCheckEnabled: boolean;
  scopeCheckModel: string;
  /** decrypted key (never sent to the client) */
  apiKey: string;
}

export interface MetaAppConfig {
  appId: string;
  appSecretEncrypted: string;
  verifyToken: string;
  redirectUri: string;
}

export interface TenantRow {
  id: string;
  ig_user_id: string;
  username: string;
  token_encrypted: string;
  token_expires_at: number | null;
  subscribed: number;
  user_id: string | null;
  auto_reply: number;
  daily_reply_limit: number;
  usage_date: string | null;
  replies_today: number;
  tokens_today: number;
  tokens_total: number;
  replies_total: number;
  settings_json: string;
  created_at: number;
  last_login_at: number;
}

export interface ConversationRow {
  id: string;
  tenant_id: string;
  sender_id: string;
  username: string;
  ai_paused: number;
  last_message_at: number;
  created_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  tenant_id: string;
  direction: Direction;
  author: string;
  text: string;
  status: string;
  created_at: number;
}


export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  google_sub: string | null;
  avatar_url: string;
  plan_id: string | null;
  created_at: number;
  last_login_at: number;
}

export interface SubscriptionOrderRow {
  id: string;
  user_id: string;
  plan_id: string;
  status: 'pending' | 'active' | 'rejected' | 'cancelled';
  period: 'monthly';
  amount: number;
  created_at: number;
  decided_at: number | null;
}

export interface TenantSession {
  role: 'tenant';
  tid: string;
  igUserId: string;
  username: string;
  exp?: number;
}

export interface AdminSession {
  role: 'admin';
  exp?: number;
}

export interface UserSession {
  role: 'user';
  uid: string;
  email: string;
  name: string;
  exp?: number;
}
