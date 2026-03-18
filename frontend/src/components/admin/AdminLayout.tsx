import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, BrainCircuit, Settings, ArrowLeft, BarChart3, ScrollText, MessageSquarePlus } from 'lucide-react';

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/llm', label: 'LLM Config', icon: BrainCircuit },
  { to: '/admin/system', label: 'System', icon: Settings },
  { to: '/admin/usage', label: 'Usage', icon: BarChart3 },
  { to: '/admin/logs', label: 'Logs', icon: ScrollText },
  { to: '/admin/feedback', label: 'Feedback', icon: MessageSquarePlus },
];

export default function AdminLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex h-screen bg-[#f5f5f7]">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-5 border-b border-gray-100">
          <h1 className="text-lg font-semibold text-gray-900">Admin Panel</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#5b8c15]/10 text-[#5b8c15]'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-gray-100">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-3 py-2 w-full rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft size={16} />
            Back to App
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
