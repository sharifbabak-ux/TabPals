import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useBlobUrl } from "./useBlobUrl";

interface MenuPhotoViewerProps {
  photo: Blob | null;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Full-screen menu photo with pinch-zoom, drag-to-pan, double-tap and wheel zoom (docs/PLAN.md Group Order UI #4). */
export function MenuPhotoViewer({ photo, onClose }: MenuPhotoViewerProps) {
  const url = useBlobUrl(photo);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; centerX: number; centerY: number } | null>(null);

  if (!photo || !url) return null;

  function measure() {
    const [a, b] = Array.from(pointers.current.values());
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), centerX: (a.x + b.x) / 2, centerY: (a.y + b.y) / 2 };
  }

  function handleDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture.current = pointers.current.size === 2 ? measure() : null;
  }

  function handleMove(event: ReactPointerEvent<HTMLDivElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 2 && gesture.current) {
      const next = measure();
      const ratio = next.distance / (gesture.current.distance || 1);
      const dx = next.centerX - gesture.current.centerX;
      const dy = next.centerY - gesture.current.centerY;
      setTransform((t) => {
        const scale = clamp(t.scale * ratio, MIN_SCALE, MAX_SCALE);
        return scale === 1 ? { scale, x: 0, y: 0 } : { scale, x: t.x + dx, y: t.y + dy };
      });
      gesture.current = next;
    } else if (pointers.current.size === 1) {
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      setTransform((t) => (t.scale > 1 ? { ...t, x: t.x + dx, y: t.y + dy } : t));
    }
  }

  function handleUp(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    gesture.current = pointers.current.size === 2 ? measure() : null;
  }

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="عکس منو">
      <button type="button" className="photo-viewer__close" onClick={onClose} aria-label="بستن">
        ×
      </button>
      <div
        className="photo-viewer__stage"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onDoubleClick={() => setTransform((t) => (t.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }))}
        onWheel={(event) =>
          setTransform((t) => {
            const scale = clamp(t.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE);
            return scale === 1 ? { scale, x: 0, y: 0 } : { ...t, scale };
          })
        }
      >
        <img
          className="photo-viewer__image"
          src={url}
          alt="منو"
          draggable={false}
          style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}
        />
      </div>
      <p className="photo-viewer__hint">برای بزرگ‌نمایی، دو انگشت را از هم باز کنید</p>
    </div>
  );
}
