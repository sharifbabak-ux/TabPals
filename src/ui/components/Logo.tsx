import { APP_NAME_FA, TAGLINE_FA } from "@/config/app";
import "./Logo.css";

interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** The "gathering table" mark — a round table cut into six equal slices, seen from above. */
export function LogoMark({ size = 40, className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 320 320"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label="نشان TabPals"
    >
      <circle cx="160" cy="160" r="70" fill="#4E5D2F" />
      <line x1="160" y1="90" x2="160" y2="230" stroke="#F3EDDF" strokeWidth="5" />
      <line x1="220.6" y1="125" x2="99.4" y2="195" stroke="#F3EDDF" strokeWidth="5" />
      <line x1="220.6" y1="195" x2="99.4" y2="125" stroke="#F3EDDF" strokeWidth="5" />
      <circle cx="160" cy="50" r="17" fill="#B8913A" />
      <circle cx="255.3" cy="105" r="17" fill="#B8913A" />
      <circle cx="255.3" cy="215" r="17" fill="#B8913A" />
      <circle cx="160" cy="270" r="17" fill="#B8913A" />
      <circle cx="64.7" cy="215" r="17" fill="#B8913A" />
      <circle cx="64.7" cy="105" r="17" fill="#B8913A" />
    </svg>
  );
}

interface LogoProps {
  variant?: "mark" | "full";
  size?: number;
  showTagline?: boolean;
}

/** Mark-only or mark + wordmark (+ Persian name/tagline) lockup. */
export function Logo({ variant = "full", size = 40, showTagline = false }: LogoProps) {
  if (variant === "mark") return <LogoMark size={size} />;

  return (
    <div className="logo">
      <LogoMark size={size} />
      <div className="logo__text">
        <span className="logo__wordmark">
          <span className="logo__wordmark-tab">Tab</span>
          <span className="logo__wordmark-pals">Pals</span>
        </span>
        <span className="logo__name-fa">{APP_NAME_FA}</span>
        {showTagline && <span className="logo__tagline">{TAGLINE_FA}</span>}
      </div>
    </div>
  );
}
