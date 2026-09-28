import type { SVGProps } from "react";

/**
 * Simple, consistent inline SVG line icons for the bottom navigation.
 * 24x24, stroke-based, currentColor so they follow the nav's
 * active/muted text color automatically.
 */
function IconBase(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" />
      <line x1="3.5" y1="9.5" x2="20.5" y2="9.5" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
    </IconBase>
  );
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 20c0-3.31 2.46-6 5.5-6s5.5 2.69 5.5 6" />
      <circle cx="17" cy="9.5" r="2.3" />
      <path d="M15.5 14.2c2.3.4 4 2.4 4 5.3" />
    </IconBase>
  );
}

export function ArchiveIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
      <path d="M5 8.5v9.5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" />
      <line x1="10" y1="12.5" x2="14" y2="12.5" />
    </IconBase>
  );
}

const GEAR_TICK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

export function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.2" />
      {GEAR_TICK_ANGLES.map((angle) => {
        const radians = (angle * Math.PI) / 180;
        const x1 = 12 + Math.cos(radians) * 7.2;
        const y1 = 12 + Math.sin(radians) * 7.2;
        const x2 = 12 + Math.cos(radians) * 9.6;
        const y2 = 12 + Math.sin(radians) * 9.6;
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
    </IconBase>
  );
}
