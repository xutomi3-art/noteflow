import { useEffect } from 'react';
import {
  MessageSquare,
  FileCheck,
  CheckCircle,
  HardDrive,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useAdminStore } from '@/stores/admin-store';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function AdminUsagePage() {
  const { usage, usagePeriod, fetchUsage, isLoading } = useAdminStore();

  useEffect(() => {
    fetchUsage(usagePeriod);
  }, [fetchUsage, usagePeriod]);

  const handlePeriod = (p: number) => {
    fetchUsage(p);
  };

  const statCards = [
    {
      label: 'Total Queries',
      value: usage?.total_queries ?? '-',
      icon: MessageSquare,
      color: '#5b8c15',
    },
    {
      label: 'Docs Processed',
      value: usage ? usage.docs_ready + usage.docs_failed : '-',
      icon: FileCheck,
      color: '#3b82f6',
    },
    {
      label: 'Success Rate',
      value: usage ? `${(usage.success_rate * 100).toFixed(1)}%` : '-',
      icon: CheckCircle,
      color: '#10b981',
    },
    {
      label: 'Storage Used',
      value: usage ? formatBytes(usage.total_storage_bytes) : '-',
      icon: HardDrive,
      color: '#8b5cf6',
    },
  ];

  const queriesData = (usage?.queries_per_day ?? []).map((d) => ({
    date: formatDate(d.date),
    count: d.count,
  }));

  const usersData = (usage?.active_users_per_day ?? []).map((d) => ({
    date: formatDate(d.date),
    count: d.count,
  }));

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold text-gray-900">Usage Analytics</h2>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm">
          {[7, 30].map((p) => (
            <button
              key={p}
              onClick={() => handlePeriod(p)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                usagePeriod === p
                  ? 'bg-[#5b8c15] text-white shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && !usage ? (
        <div className="flex items-center gap-2 text-gray-400">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-transparent" />
          Loading...
        </div>
      ) : (
        <>
          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {statCards.map(({ label, value, icon: Icon, color }) => (
              <div
                key={label}
                className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="p-2 rounded-lg"
                    style={{ backgroundColor: color + '15' }}
                  >
                    <Icon size={18} style={{ color }} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">{value}</div>
                <div className="text-sm text-gray-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Queries per Day */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Queries per Day
              </h3>
              {queriesData.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={queriesData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#5b8c15"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#5b8c15' }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Active Users per Day */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Active Users per Day
              </h3>
              {usersData.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={usersData} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '8px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                        fontSize: '12px',
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#4285F4"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#4285F4' }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Users */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Top Users by Queries
              </h3>
              {!usage?.top_users?.length ? (
                <p className="text-sm text-gray-400 py-4 text-center">No data</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-medium w-8">#</th>
                      <th className="pb-2 font-medium">User</th>
                      <th className="pb-2 font-medium text-right">Queries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {usage.top_users.map((u, i) => (
                      <tr key={u.email} className="group">
                        <td className="py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="py-2.5">
                          <div className="font-medium text-gray-900 truncate max-w-[140px]">
                            {u.name}
                          </div>
                          <div className="text-xs text-gray-400 truncate max-w-[140px]">
                            {u.email}
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className="font-semibold text-gray-900">
                            {u.query_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Top Notebooks */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">
                Top Notebooks by Sources
              </h3>
              {!usage?.top_notebooks?.length ? (
                <p className="text-sm text-gray-400 py-4 text-center">No data</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                      <th className="pb-2 font-medium w-8">#</th>
                      <th className="pb-2 font-medium">Notebook</th>
                      <th className="pb-2 font-medium text-right">Sources</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {usage.top_notebooks.map((nb, i) => (
                      <tr key={nb.name + i} className="group">
                        <td className="py-2.5 text-gray-400 text-xs">{i + 1}</td>
                        <td className="py-2.5">
                          <span className="mr-1.5">{nb.emoji || '📓'}</span>
                          <span className="font-medium text-gray-900 truncate max-w-[160px]">
                            {nb.name}
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className="font-semibold text-gray-900">
                            {nb.source_count}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
