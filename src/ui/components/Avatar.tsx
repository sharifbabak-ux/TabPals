import { useEffect, useState } from "react";
import "./Avatar.css";

interface AvatarProps {
  id: string;
  name: string;
  photo?: Blob;
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

/** Circular avatar: shows the person's photo if present, else initials with a color derived deterministically from their id. */
export function Avatar({ id, name, photo, size = 36 }: AvatarProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="avatar avatar--photo"
        style={{ width: size, height: size }}
        aria-hidden="true"
      />
    );
  }

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
