import { useEffect, useRef } from "react";

/**
 * Traps the Android/browser back gesture while a voucher wizard sheet is
 * open, so it steps back through the wizard instead of leaving the page or
 * closing the sheet (docs/PLAN.md Stage 3B.1 — "Android/browser back never
 * cancels the voucher"). While open, one history entry is pushed; every
 * `popstate` re-pushes the trap entry and calls `onBack`, which the caller
 * uses to go to the previous wizard step (or do nothing at the first step).
 */
export function useWizardBackTrap(open: boolean, onBack: () => void): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ tabpalWizard: true }, "");
    const handlePopState = () => {
      window.history.pushState({ tabpalWizard: true }, "");
      onBackRef.current();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [open]);
}
