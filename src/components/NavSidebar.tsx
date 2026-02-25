import { useLocation, useNavigate } from 'react-router-dom'

const navItems = [
  { path: '/', icon: '🏠', label: 'Dashboard' },
  { path: '/finances', icon: '💰', label: 'Finances' },
]

export default function NavSidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="fixed left-0 top-0 h-full w-14 bg-white/5 backdrop-blur-xl border-r border-white/10 flex flex-col items-center pt-4 gap-2 z-50">
      {navItems.map(item => {
        const active = location.pathname === item.path
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            title={item.label}
            className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all
              ${active ? 'bg-white/15 shadow-lg shadow-blue-500/10' : 'hover:bg-white/10 opacity-60 hover:opacity-100'}`}
          >
            {item.icon}
          </button>
        )
      })}
    </nav>
  )
}
