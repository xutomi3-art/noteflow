import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSharingStore } from './sharing-store';
import { api } from '@/services/api';
import type { Member, InviteLink } from '@/types/api';

const makeMember = (overrides: Partial<Member> = {}): Member => ({
  user_id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'editor',
  joined_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

const makeInviteLink = (overrides: Partial<InviteLink> = {}): InviteLink => ({
  id: 'link-1',
  token: 'abc123',
  role: 'viewer',
  expires_at: null,
  created_at: '2024-01-01T00:00:00Z',
  ...overrides,
});

beforeEach(() => {
  useSharingStore.setState({
    members: [],
    inviteLinks: [],
    isLoading: false,
  });
  vi.restoreAllMocks();
});

describe('useSharingStore', () => {
  describe('initial state', () => {
    it('should start empty', () => {
      const state = useSharingStore.getState();
      expect(state.members).toEqual([]);
      expect(state.inviteLinks).toEqual([]);
      expect(state.isLoading).toBe(false);
    });
  });

  describe('fetchMembers', () => {
    it('should fetch and set members', async () => {
      const members = [makeMember(), makeMember({ user_id: 'user-2' })];
      vi.spyOn(api, 'getMembers').mockResolvedValueOnce(members);

      await useSharingStore.getState().fetchMembers('nb-1');

      const state = useSharingStore.getState();
      expect(state.members).toEqual(members);
      expect(state.isLoading).toBe(false);
    });

    it('should set isLoading false on error', async () => {
      vi.spyOn(api, 'getMembers').mockRejectedValueOnce(new Error('fail'));

      await useSharingStore.getState().fetchMembers('nb-1').catch(() => {});

      expect(useSharingStore.getState().isLoading).toBe(false);
    });
  });

  describe('createInviteLink', () => {
    it('should create and prepend invite link', async () => {
      const existing = makeInviteLink({ id: 'link-old' });
      useSharingStore.setState({ inviteLinks: [existing] });

      const newLink = makeInviteLink({ id: 'link-new', token: 'xyz' });
      vi.spyOn(api, 'createInviteLink').mockResolvedValueOnce(newLink);

      const result = await useSharingStore.getState().createInviteLink('nb-1', 'viewer');

      expect(result).toEqual(newLink);
      const state = useSharingStore.getState();
      expect(state.inviteLinks[0].id).toBe('link-new');
      expect(state.inviteLinks[1].id).toBe('link-old');
    });
  });

  describe('sendEmailInvite', () => {
    it('should send email invite and return result', async () => {
      const result = { message: 'Sent', join_url: 'http://example.com/join/abc' };
      vi.spyOn(api, 'sendEmailInvite').mockResolvedValueOnce(result);

      const response = await useSharingStore.getState().sendEmailInvite('nb-1', 'test@example.com', 'editor');

      expect(response).toEqual(result);
    });
  });

  describe('updateMemberRole', () => {
    it('should update member role in place', async () => {
      const members = [
        makeMember({ user_id: 'user-1', role: 'viewer' }),
        makeMember({ user_id: 'user-2', role: 'editor' }),
      ];
      useSharingStore.setState({ members });
      vi.spyOn(api, 'updateMemberRole').mockResolvedValueOnce(undefined);

      await useSharingStore.getState().updateMemberRole('nb-1', 'user-1', 'editor');

      const state = useSharingStore.getState();
      expect(state.members[0].role).toBe('editor');
      expect(state.members[1].role).toBe('editor');
    });
  });

  describe('removeMember', () => {
    it('should remove member from list', async () => {
      const members = [
        makeMember({ user_id: 'user-1' }),
        makeMember({ user_id: 'user-2' }),
      ];
      useSharingStore.setState({ members });
      vi.spyOn(api, 'removeMember').mockResolvedValueOnce(undefined);

      await useSharingStore.getState().removeMember('nb-1', 'user-1');

      const state = useSharingStore.getState();
      expect(state.members).toHaveLength(1);
      expect(state.members[0].user_id).toBe('user-2');
    });
  });

  describe('stopSharing', () => {
    it('should clear members and invite links', async () => {
      useSharingStore.setState({
        members: [makeMember()],
        inviteLinks: [makeInviteLink()],
      });
      vi.spyOn(api, 'stopSharing').mockResolvedValueOnce(undefined);

      await useSharingStore.getState().stopSharing('nb-1');

      const state = useSharingStore.getState();
      expect(state.members).toEqual([]);
      expect(state.inviteLinks).toEqual([]);
    });
  });

  describe('transferOwnership', () => {
    it('should call transferOwnership API', async () => {
      const spy = vi.spyOn(api, 'transferOwnership').mockResolvedValueOnce(undefined);

      await useSharingStore.getState().transferOwnership('nb-1', 'user-2');

      expect(spy).toHaveBeenCalledWith('nb-1', 'user-2');
    });
  });

  describe('reset', () => {
    it('should reset all state', () => {
      useSharingStore.setState({
        members: [makeMember()],
        inviteLinks: [makeInviteLink()],
        isLoading: true,
      });

      useSharingStore.getState().reset();

      const state = useSharingStore.getState();
      expect(state.members).toEqual([]);
      expect(state.inviteLinks).toEqual([]);
      expect(state.isLoading).toBe(false);
    });
  });
});
