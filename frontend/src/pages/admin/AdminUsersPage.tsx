import { useEffect, useState } from 'react';
import { Search, Shield, ShieldOff, Ban, CheckCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AdminUsersPage() {
  const { users, usersTotal, usersPage, fetchUsers, toggleUserDisabled, toggleUserAdmin } = useAdminStore();
  const [search, setSearch] = useState('');
  const totalPages = Math.ceil(usersTotal / 20);

  useEffect(() => {
    fetchUsers({ page: 1 });
  }, [fetchUsers]);

  const handleSearch = () => {
    fetchUsers({ search, page: 1 });
  };

  return (
    <div className="max-w-6xl">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">Users</h2>

      {/* Search */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#5b8c15]/30 focus:border-[#5b8c15]"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-[#5b8c15] text-white rounded-lg text-sm font-medium hover:bg-[#4a7012] transition-colors"
        >
          Search
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Notebooks</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Docs</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Last Active</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
              <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 flex items-center gap-1.5">
                        {user.name}
                        {user.is_admin && (
                          <span className="text-[10px] bg-[#5b8c15]/10 text-[#5b8c15] px-1.5 py-0.5 rounded font-medium">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-gray-400 text-xs">{user.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.notebook_count}</td>
                <td className="px-4 py-3 text-gray-600">{user.document_count}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(user.last_active_at)}</td>
                <td className="px-4 py-3">
                  {user.is_disabled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                      Disabled
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => toggleUserDisabled(user.id, !user.is_disabled)}
                      title={user.is_disabled ? 'Enable user' : 'Disable user'}
                      className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                    >
                      {user.is_disabled ? <CheckCircle size={15} /> : <Ban size={15} />}
                    </button>
                    <button
                      onClick={() => toggleUserAdmin(user.id, !user.is_admin)}
                      title={user.is_admin ? 'Remove admin' : 'Make admin'}
                      className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600"
                    >
                      {user.is_admin ? <ShieldOff size={15} /> : <Shield size={15} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
          <span>{usersTotal} users total</span>
          <div className="flex items-center gap-2">
            <button
              disabled={usersPage <= 1}
              onClick={() => fetchUsers({ page: usersPage - 1 })}
              className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span>Page {usersPage} of {totalPages}</span>
            <button
              disabled={usersPage >= totalPages}
              onClick={() => fetchUsers({ page: usersPage + 1 })}
              className="p-1.5 rounded-md hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
