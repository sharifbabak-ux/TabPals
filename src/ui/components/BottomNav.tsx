import { NavLink } from "react-router-dom";
import "./BottomNav.css";

const NAV_ITEMS = [
  { to: "/events", label: "ایونت‌ها", icon: "🗓️" },
  { to: "/people", label: "اشخاص", icon: "👥" },
  { to: "/backup", label: "پشتیبان", icon: "🗄️" },
  { to: "/settings", label: "تنظیمات", icon: "⚙️" }
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="ناوبری اصلی">
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}`}
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span className="bottom-nav__label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
