import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../authContextValue";
import menus from "../menu";
import { useEffect, useState } from "react";

export default function Layout() {
  const { user, logout } = useAuth();
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  return (
    <div className="app">
      <aside className="sidebar">
        <h2>HCM Lite</h2>
        <nav>
          {menus[user.role].map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/"}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <small>{user.email}</small>
          <small>Role: {user.role}</small>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button onClick={logout}>Logout</button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
