export interface DashboardStats {
  total_users: number;
  total_notebooks: number;
  total_documents: number;
  storage_bytes: number;
  active_users_7d: number;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string | null;
  last_active_at: string | null;
  notebook_count: number;
  document_count: number;
}

export interface UserListResponse {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
}

export interface SystemSettingItem {
  key: string;
  value: string;
  source: 'db' | 'env';
  updated_at: string | null;
}

export interface ServiceHealth {
  status: 'ok' | 'error';
  latency_ms: number;
  message?: string;
}

export interface UsageStats {
  period_days: number;
  total_queries: number;
  docs_ready: number;
  docs_failed: number;
  total_storage_bytes: number;
  success_rate: number;
  queries_per_day: { date: string; count: number }[];
  active_users_per_day: { date: string; count: number }[];
  top_users: { name: string; email: string; query_count: number }[];
  top_notebooks: { name: string; emoji: string; source_count: number }[];
}
