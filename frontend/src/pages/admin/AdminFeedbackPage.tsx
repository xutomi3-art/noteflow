import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Bug, Sparkles, CheckCircle, Circle, ExternalLink } from 'lucide-react';
import { api } from '@/services/api';
import type { FeedbackItem } from '@/types/admin';

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
];

const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Bug', value: 'bug' },
  { label: 'Wish', value: 'wish' },
];

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const limit = 20;

  const fetchData = useCallback(async (params?: { status?: string; type?: string; page?: number }) => {
    const s = params?.status ?? statusFilter;
    const t = params?.type ?? typeFilter;
    const p = params?.page ?? page;
    setIsLoading(true);
    setStatusFilter(s);
    setTypeFilter(t);
    setPage(p);
    try {
      const data = await api.getAdminFeedback({
        status: s || undefined,
        type: t || undefined,
        page: p,
        limit,
      });
      setItems(data.items);
      setTotal(data.total);
      setPage(data.page);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, typeFilter, page]);

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleStatus = async (feedbackId: string) => {
    try {
      const result = await api.updateAdminFeedbackStatus(feedbackId);
      setItems((prev) =>
        prev.map((item) =>
          item.id === feedbackId
            ? { ...item, status: result.status as 'open' | 'resolved', resolved_at: (result as { resolved_at?: string }).resolved_at || null }
            : item
        )
      );
    } catch {
      // ignore
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Feedback</h2>
        <p className="text-sm text-gray-500 mt-1">
          Bug reports and feature wishes from users
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          {/* Status filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => fetchData({ status: f.value, page: 1 })}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  statusFilter === f.value
                    ? 'bg-[#5b8c15] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => fetchData({ type: f.value, page: 1 })}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  typeFilter === f.value
                    ? 'bg-[#5b8c15] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => fetchData()}
          disabled={isLoading}
          className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 font-medium w-16">Type</th>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Content</th>
                <th className="px-4 py-3 font-medium w-20">Screenshot</th>
                <th className="px-4 py-3 font-medium w-24 text-center">Status</th>
                <th className="px-4 py-3 font-medium w-28">Date</th>
                <th className="px-4 py-3 font-medium w-28 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                    No feedback found
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      {item.type === 'bug' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700">
                          <Bug size={12} /> Bug
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          <Sparkles size={12} /> Wish
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-700 text-xs font-medium">{item.user_name}</div>
                      <div className="text-gray-400 text-xs">{item.user_email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-600 text-xs line-clamp-2" title={item.content}>
                        {item.content}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.screenshot_url ? (
                        <a
                          href={item.screenshot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          <ExternalLink size={12} /> View
                        </a>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          item.status === 'open'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-emerald-50 text-emerald-700'
                        }`}
                      >
                        {item.status === 'open' ? <Circle size={10} /> : <CheckCircle size={10} />}
                        {item.status === 'open' ? 'Open' : 'Resolved'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {timeAgo(item.created_at)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => handleToggleStatus(item.id)}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                          item.status === 'open'
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {item.status === 'open' ? 'Mark Resolved' : 'Reopen'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => fetchData({ page: page - 1 })}
                disabled={page <= 1}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-500">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => fetchData({ page: page + 1 })}
                disabled={page >= totalPages}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {isLoading && items.length > 0 && (
        <div className="flex justify-center mt-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-transparent" />
        </div>
      )}
    </div>
  );
}
