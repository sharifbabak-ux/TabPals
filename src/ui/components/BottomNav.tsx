import { NavLink } from "react-router-dom";
import { ArchiveIcon, CalendarIcon, SettingsIcon, UsersIcon } from "./icons";
import "./BottomNav.css";

const NAV_ITEMS = [
  { to: "/events", label: "ایونت‌ها", Icon: CalendarIcon },
  { to: "/people", label: "اشخاص", Icon: UsersIcon },
  { to: "/backup", label: "پشتیبان", Icon: ArchiveIcon },
  { to: "/settings", label: "تنظیمات", Icon: SettingsIcon }
];

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="ناوبری اصلی">
      {NAV_ITEMS.map(({ to, label, Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}`}>
          <span className="bottom-nav__icon">
            <Icon />
          </span>
          <span className="bottom-nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
