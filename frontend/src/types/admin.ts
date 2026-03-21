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

export interface ChatLogItem {
  id: string;
  user_email: string;
  user_name: string;
  notebook_name: string;
  message_preview: string;
  message_full: string | null;
  response_preview: string | null;
  response_full: string | null;
  feedback: string | null;
  total_duration: number | null;
  ragflow_duration: number | null;
  excel_duration: number | null;
  llm_duration: number | null;
  llm_first_token: number | null;
  source_count: number | null;
  chunk_count: number | null;
  thinking_mode: boolean;
  has_excel: boolean;
  llm_model: string | null;
  token_count: number | null;
  status: string;
  error_message: string | null;
  created_at: string;
}

export interface FeedbackItem {
  id: string;
  user_name: string;
  user_email: string;
  type: 'bug' | 'wish';
  content: string;
  screenshot_url: string | null;
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
}

export interface HostResources {
  cpu_percent: number;
  memory_percent: number;
  memory_used_gb: number;
  memory_total_gb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
}

export interface ContainerResources {
  name: string;
  cpu_percent: number;
  memory_mb: number;
  memory_limit_mb: number;
  memory_percent: number;
}

export interface ResourcesData {
  host: HostResources;
  containers: ContainerResources[];
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
