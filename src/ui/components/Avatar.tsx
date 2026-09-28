import "./Avatar.css";

interface AvatarProps {
  id: string;
  name: string;
  size?: number;
}

const PALETTE_SIZE = 6;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "؟";
  if (words.length === 1) return words[0].slice(0, 2);
  return words[0].slice(0, 1) + words[1].slice(0, 1);
}

function paletteIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % PALETTE_SIZE;
}

/** Circular initials avatar; background color is derived deterministically from the person's id. */
export function Avatar({ id, name, size = 36 }: AvatarProps) {
  return (
    <span
      className={`avatar avatar--${paletteIndex(id)}`}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
