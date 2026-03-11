import { useEffect } from 'react';
import { Users, BookOpen, FileText, HardDrive, Activity } from 'lucide-react';
import { useAdminStore } from '@/stores/admin-store';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function AdminDashboardPage() {
  const { stats, fetchDashboard, isLoading } = useAdminStore();

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

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
    </div>
  );
}
