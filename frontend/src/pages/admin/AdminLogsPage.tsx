import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';
import type { ChatLogItem } from '@/types/admin';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(value: number | null): string {
  if (value == null) return '-';
  return value.toFixed(2) + 's';
}

function durationColor(value: number | null): string {
  if (value == null) return 'text-gray-400';
  if (value < 5) return 'text-emerald-600';
  if (value < 15) return 'text-amber-600';
  return 'text-red-600';
}

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'OK', value: 'ok' },
  { label: 'Error', value: 'error' },
];

function ExpandedRow({ log }: { log: ChatLogItem }) {
  const [showFullResponse, setShowFullResponse] = useState(false);

  return (
    <tr>
      <td colSpan={12} className="px-4 py-3 bg-gray-50/80">
        <div className="space-y-3">
          {/* Metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-gray-400">Model:</span>{' '}
              <span className="text-gray-700 font-medium">{log.llm_model || '-'}</span>
            </div>
            <div>
              <span className="text-gray-400">Thinking:</span>{' '}
              <span className="text-gray-700 font-medium">{log.thinking_mode ? 'Yes' : 'No'}</span>
            </div>
            <div>
              <span className="text-gray-400">Excel:</span>{' '}
              <span className="text-gray-700 font-medium">{log.has_excel ? 'Yes' : 'No'}</span>
            </div>
            <div>
              <span className="text-gray-400">Excel Duration:</span>{' '}
              <span className="text-gray-700 font-medium">{formatDuration(log.excel_duration)}</span>
            </div>
            <div>
              <span className="text-gray-400">Sources:</span>{' '}
              <span className="text-gray-700 font-medium">{log.source_count ?? '-'}</span>
            </div>
            <div>
              <span className="text-gray-400">Chunks:</span>{' '}
              <span className="text-gray-700 font-medium">{log.chunk_count ?? '-'}</span>
            </div>
            <div>
              <span className="text-gray-400">Tokens:</span>{' '}
              <span className="text-gray-700 font-medium">{log.token_count ?? '-'}</span>
            </div>
            <div>
              <span className="text-gray-400">User:</span>{' '}
              <span className="text-gray-700 font-medium">{log.user_name}</span>
            </div>
          </div>

          {/* AI Response */}
          {log.response_preview && (
            <div className="text-xs">
              <span className="text-gray-400 font-medium">Response:</span>
              <div className="mt-1 p-2 bg-white rounded border border-gray-200 text-gray-700 whitespace-pre-wrap">
                {showFullResponse && log.response_full
                  ? log.response_full
                  : log.response_preview}
                {log.response_full && log.response_full.length > 200 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowFullResponse(!showFullResponse); }}
                    className="ml-1 text-blue-500 hover:text-blue-700 font-medium"
                  >
                    {showFullResponse ? '...collapse' : '...expand'}
                  </button>
                )}
              </div>
            </div>
          )}

          {log.error_message && (
            <div className="text-xs">
              <span className="text-gray-400">Error:</span>{' '}
              <span className="text-red-600 font-medium">{log.error_message}</span>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function AdminLogsPage() {
  const { logs, logsTotal, logsPage, logsStatus, fetchLogs, isLoading } = useAdminStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  const handleStatusFilter = useCallback(
    (status: string) => {
      fetchLogs({ status, page: 1 });
    },
    [fetchLogs],
  );

  const handlePage = useCallback(
    (page: number) => {
      fetchLogs({ page });
    },
    [fetchLogs],
  );

  const totalPages = Math.max(1, Math.ceil(logsTotal / 50));

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Request Logs</h2>
        <p className="text-sm text-gray-500 mt-1">
          Monitor chat request performance and diagnose issues
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        {/* Status filter tabs */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => handleStatusFilter(f.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                logsStatus === f.value
                  ? 'bg-[#5b8c15] text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              autoRefresh
                ? 'bg-[#5b8c15]/10 border-[#5b8c15]/30 text-[#5b8c15]'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button
            onClick={() => fetchLogs()}
            disabled={isLoading}
            className="p-2 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 bg-gray-50/50">
                <th className="px-2 py-3 font-medium w-8"></th>
                <th className="px-2 py-3 font-medium">ID</th>
                <th className="px-2 py-3 font-medium">Time</th>
                <th className="px-3 py-3 font-medium">User</th>
                <th className="px-3 py-3 font-medium">Notebook</th>
                <th className="px-3 py-3 font-medium">Message</th>
                <th className="px-2 py-3 font-medium text-right">Total</th>
                <th className="px-2 py-3 font-medium text-right">RAGFlow</th>
                <th className="px-2 py-3 font-medium text-right">LLM</th>
                <th className="px-2 py-3 font-medium text-right">1st Token</th>
                <th className="px-2 py-3 font-medium text-center">Feedback</th>
                <th className="px-2 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.length === 0 && !isLoading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-gray-400">
                    No logs found
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  return (
                    <LogRow
                      key={log.id}
                      log={log}
                      isExpanded={isExpanded}
                      onToggle={() => setExpandedId(isExpanded ? null : log.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {logsTotal > 50 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">
              Showing {(logsPage - 1) * 50 + 1}-{Math.min(logsPage * 50, logsTotal)} of {logsTotal}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handlePage(logsPage - 1)}
                disabled={logsPage <= 1}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs text-gray-500">
                {logsPage} / {totalPages}
              </span>
              <button
                onClick={() => handlePage(logsPage + 1)}
                disabled={logsPage >= totalPages}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {isLoading && logs.length > 0 && (
        <div className="flex justify-center mt-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-transparent" />
        </div>
      )}
    </div>
  );
}

function LogRow({
  log,
  isExpanded,
  onToggle,
}: {
  log: ChatLogItem;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="hover:bg-gray-50/50 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-2 py-2.5 text-gray-400">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </td>
        <td className="px-2 py-2.5 text-gray-400 font-mono text-[10px]">
          {log.id?.slice(0, 8)}
        </td>
        <td className="px-2 py-2.5 text-gray-500 whitespace-nowrap text-xs">
          {formatTime(log.created_at)}
        </td>
        <td className="px-3 py-2.5">
          <span className="text-gray-700 truncate max-w-[140px] block text-xs">
            {log.user_email}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span className="text-gray-700 truncate max-w-[120px] block text-xs">
            {log.notebook_name}
          </span>
        </td>
        <td className="px-3 py-2.5">
          <span className="text-gray-600 truncate max-w-[200px] block text-xs">
            {log.message_preview}
          </span>
        </td>
        <td className={`px-2 py-2.5 text-right font-mono text-xs font-medium ${durationColor(log.total_duration)}`}>
          {formatDuration(log.total_duration)}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs text-gray-500">
          {formatDuration(log.ragflow_duration)}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs text-gray-500">
          {formatDuration(log.llm_duration)}
        </td>
        <td className="px-2 py-2.5 text-right font-mono text-xs text-gray-500">
          {formatDuration(log.llm_first_token)}
        </td>
        <td className="px-2 py-2.5 text-center">
          {log.feedback === 'up' ? (
            <ThumbsUp size={14} className="inline text-green-600" />
          ) : log.feedback === 'down' ? (
            <ThumbsDown size={14} className="inline text-red-500" />
          ) : (
            <span className="text-gray-300">-</span>
          )}
        </td>
        <td className="px-2 py-2.5 text-center">
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
              log.status === 'ok'
                ? 'bg-emerald-50 text-emerald-700'
                : log.status === 'error'
                ? 'bg-red-50 text-red-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            {log.status === 'ok' ? 'OK' : log.status === 'error' ? 'Error' : log.status}
          </span>
        </td>
      </tr>
      {isExpanded && <ExpandedRow log={log} />}
    </>
  );
}
