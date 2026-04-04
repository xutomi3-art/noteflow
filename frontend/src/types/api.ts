export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  is_admin: boolean;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Notebook {
  id: string;
  name: string;
  emoji: string;
  cover_color: string;
  owner_id: string;
  is_shared: boolean;
  shared_chat: boolean;
  custom_prompt: string | null;
  suggestion_level: string;
  user_role: string;
  source_count: number;
  member_count: number;
  created_at: string;
  updated_at: string;
  joined_at: string | null;
}

export interface Source {
  id: string;
  notebook_id: string;
  filename: string;
  file_type: string;
  file_size: number | null;
  status: "uploading" | "parsing" | "vectorizing" | "ready" | "failed";
  error_message: string | null;
  progress: number | null;
  created_at: string;
}

export interface Citation {
  index: number;
  source_id: string;
  filename: string;
  file_type: string;
  location: {
    page?: number;
    slide?: number;
    paragraph?: number;
  };
  excerpt: string;
}

export interface ChatMessage {
  id: string;
  notebook_id: string;
  user_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
  user_name?: string;
  metadata?: {
    type: string;
    meeting_id?: string;
    title?: string;
    collapsed_summary?: string;
    skill_type?: string;
    skill_label?: string;
    suggestions?: Array<{type: string; text: string}>;
  } | null;
}

export interface SavedNote {
  id: string;
  notebook_id: string;
  source_message_id: string | null;
  content: string;
  created_at: string;
}

export interface CustomSkill {
  id: string;
  name: string;
  prompt: string;
  icon: string;
  created_by: string;
  notebook_id: string;
  all_notebooks: boolean;
  shared_with_team: boolean;
}

export interface InviteLink {
  id: string;
  token: string;
  role: string;
  expires_at: string | null;
  created_at: string;
}

export interface Member {
  user_id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  joined_at: string;
  status?: "active" | "pending";
}
