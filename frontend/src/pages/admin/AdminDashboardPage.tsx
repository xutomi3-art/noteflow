import { useEffect } from 'react';
import { Users, BookOpen, FileText, HardDrive, Activity, Cpu, MemoryStick, Server } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

const SERVICE_LABELS: Record<string, string> = {
  postgresql: 'PostgreSQL',
  ragflow: 'RAGFlow',
  elasticsearch: 'Elasticsearch',
  redis: 'Redis',
  mineru: 'MinerU',
  docmee: 'Docmee AiPPT',
  deepseek: 'DeepSeek',
  qwen: 'LLM',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function PercentBar({ value, warn = 80, danger = 90 }: { value: number; warn?: number; danger?: number }) {
  const color = value >= danger ? 'bg-red-500' : value >= warn ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

export default function AdminDashboardPage() {
  const { stats, health, resources, fetchDashboard, fetchHealth, fetchResources, isLoading } = useAdminStore();

  useEffect(() => {
    fetchDashboard();
    fetchHealth();
    fetchResources();
  }, [fetchDashboard, fetchHealth, fetchResources]);

  const cards = [
    { label: 'Total Users', value: stats?.total_users ?? '-', icon: Users, color: '#5b8c15' },
    { label: 'Notebooks', value: stats?.total_notebooks ?? '-', icon: BookOpen, color: '#3b82f6' },
    { label: 'Documents', value: stats?.total_documents ?? '-', icon: FileText, color: '#f59e0b' },
    { label: 'Storage', value: stats ? formatBytes(stats.storage_bytes) : '-', icon: HardDrive, color: '#8b5cf6' },
    { label: 'Active (7d)', value: stats?.active_users_7d ?? '-', icon: Activity, color: '#10b981' },
  ];

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h2>

      {isLoading && !stats ? (
        <div className="flex items-center gap-2 text-gray-400">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-gray-300 border-t-transparent" />
          Loading...
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: color + '15' }}>
                  <Icon size={18} style={{ color }} />
                </div>
              </div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
              <div className="text-sm text-gray-500 mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Host Resources */}
      {resources && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Server Resources</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* CPU */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Cpu size={14} className="text-blue-500" />
                <span className="text-sm text-gray-600">CPU</span>
                <span className="ml-auto text-sm font-semibold text-gray-900">{resources.host.cpu_percent}%</span>
              </div>
              <PercentBar value={resources.host.cpu_percent} />
            </div>
            {/* Memory */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick size={14} className="text-purple-500" />
                <span className="text-sm text-gray-600">Memory</span>
                <span className="ml-auto text-sm font-semibold text-gray-900">
                  {resources.host.memory_used_gb}GB / {resources.host.memory_total_gb}GB
                </span>
              </div>
              <PercentBar value={resources.host.memory_percent} />
            </div>
            {/* Disk */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={14} className="text-amber-500" />
                <span className="text-sm text-gray-600">Disk</span>
                <span className="ml-auto text-sm font-semibold text-gray-900">
                  {resources.host.disk_used_gb}GB / {resources.host.disk_total_gb}GB
                </span>
              </div>
              <PercentBar value={resources.host.disk_percent} />
            </div>
          </div>
        </div>
      )}

      {/* Container Resources */}
      {resources && resources.containers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mt-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            <div className="flex items-center gap-2">
              <Server size={14} className="text-gray-500" />
              Containers
            </div>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs border-b border-gray-100">
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium w-[200px]">CPU</th>
                  <th className="pb-2 font-medium w-[200px]">Memory</th>
                </tr>
              </thead>
              <tbody>
                {resources.containers.map((c) => (
                  <tr key={c.name} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-gray-800 font-medium">{c.name}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <PercentBar value={c.cpu_percent} warn={60} danger={80} />
                        </div>
                        <span className="text-xs text-gray-500 w-12 text-right">{c.cpu_percent}%</span>
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <PercentBar value={c.memory_percent} warn={70} danger={85} />
                        </div>
                        <span className="text-xs text-gray-500 w-20 text-right">
                          {c.memory_mb < 1024
                            ? `${c.memory_mb}MB`
                            : `${(c.memory_mb / 1024).toFixed(1)}GB`
                          }
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Service Health Overview */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-700">Service Status</h3>
          {Object.keys(health).length > 0 && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              Object.values(health).every(h => h.status === 'ok')
                ? 'bg-green-50 text-green-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {Object.values(health).filter(h => h.status === 'ok').length}/{Object.keys(health).length} healthy
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          {Object.keys(health).length === 0 ? (
            <p className="text-sm text-gray-400">Loading...</p>
          ) : (
            Object.entries(health).map(([key, h]) => (
              <div key={key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50">
                <div className={`w-2 h-2 rounded-full ${h.status === 'ok' ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-gray-700">{SERVICE_LABELS[key] || key}</span>
                {h.status === 'ok' && h.latency_ms != null && (
                  <span className="text-[10px] text-gray-400">{h.latency_ms}ms</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
