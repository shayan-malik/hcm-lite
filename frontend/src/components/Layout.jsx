import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../authContextValue'; 
import menus from '../menu';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>HCM Lite</h2>
        <nav>
          {menus[user.role].map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <small>{user.email}</small>
          <small>Role: {user.role}</small>
          <button onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}