import { create } from "zustand";
import type { Member, InviteLink } from "@/types/api";
import { api } from "@/services/api";

interface SharingState {
  members: Member[];
  inviteLinks: InviteLink[];
  isLoading: boolean;

  fetchMembers: (notebookId: string) => Promise<void>;
  createInviteLink: (notebookId: string, role: string, email?: string) => Promise<InviteLink>;
  sendEmailInvite: (notebookId: string, email: string, role: string) => Promise<{ message: string; join_url?: string }>;
  updateMemberRole: (notebookId: string, userId: string, role: string) => Promise<void>;
  removeMember: (notebookId: string, userId: string) => Promise<void>;
  stopSharing: (notebookId: string) => Promise<void>;
  transferOwnership: (notebookId: string, newOwnerId: string) => Promise<void>;
  reset: () => void;
}

export const useSharingStore = create<SharingState>((set) => ({
  members: [],
  inviteLinks: [],
  isLoading: false,

  fetchMembers: async (notebookId: string) => {
    set({ isLoading: true });
    try {
      const members = await api.getMembers(notebookId);
      set({ members });
    } finally {
      set({ isLoading: false });
    }
  },

  createInviteLink: async (notebookId: string, role: string, email?: string) => {
    const link = await api.createInviteLink(notebookId, role, email);
    set((state) => ({ inviteLinks: [link, ...state.inviteLinks] }));
    return link;
  },

  sendEmailInvite: async (notebookId: string, email: string, role: string) => {
    const result = await api.sendEmailInvite(notebookId, email, role);
    return result;
  },

  updateMemberRole: async (notebookId: string, userId: string, role: string) => {
    await api.updateMemberRole(notebookId, userId, role);
    set((state) => ({
      members: state.members.map((m) =>
        m.user_id === userId ? { ...m, role } : m
      ),
    }));
  },

  removeMember: async (notebookId: string, userId: string) => {
    await api.removeMember(notebookId, userId);
    set((state) => ({
      members: state.members.filter((m) => m.user_id !== userId),
    }));
  },

  stopSharing: async (notebookId: string) => {
    await api.stopSharing(notebookId);
    set({ members: [], inviteLinks: [] });
  },

  transferOwnership: async (notebookId: string, newOwnerId: string) => {
    await api.transferOwnership(notebookId, newOwnerId);
  },

  reset: () => set({ members: [], inviteLinks: [], isLoading: false }),
}));
