import { Outlet, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

function Layout() {
  const { user, logout } = useAuthStore();

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-white shadow-lg">
        <div className="p-6">
          <h1 className="text-2xl font-bold">Zinto</h1>
        </div>

        <nav className="mt-6">
          <Link to="/" className="block px-6 py-3 hover:bg-gray-800">
            Dashboard
          </Link>
          <Link to="/users" className="block px-6 py-3 hover:bg-gray-800">
            Usuarios
          </Link>
          <Link to="/departments" className="block px-6 py-3 hover:bg-gray-800">
            Departamentos
          </Link>
          <Link to="/projects" className="block px-6 py-3 hover:bg-gray-800">
            Proyectos
          </Link>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="bg-white shadow">
          <div className="max-w-7xl mx-auto py-6 px-4 flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-900">ERP System</h2>
            <div className="flex items-center gap-4">
              <span className="text-gray-700">{user?.email}</span>
              <button
                onClick={logout}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default Layout;
