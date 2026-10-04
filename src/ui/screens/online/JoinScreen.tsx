import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { onlineService } from "@/data/online/onlineService";
import { formatShortCode, parseInviteKey, parseInviteLinkCode, parseInviteToken } from "@/domain/inviteLink";
import { clipboardService, platform } from "@/platform";
import { Toast } from "@/ui/components/Toast";
import { JoinWithInviteSheet } from "./JoinWithInviteSheet";
import "./online.css";

/** Tokens already submitted in this page load: an invite is single-use, so a re-render/StrictMode remount must never redeem twice. */
const submittedTokens = new Set<string>();

function MenuIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}
function ShareIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/**
 * Route `#/join?t=<token>`. In a browser tab (not an installed app) it asks
 * the user to install the app first and shows the short code to type there;
 * inside the installed app it redeems the invite directly.
 */
export function JoinScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search ? `${location.pathname}${location.search}` : location.pathname;
  const token = parseInviteToken(search);
  const shortCode = parseInviteLinkCode(search);
  const eventKey = parseInviteKey(search);

  const standalone = platform.getInfo().isStandalone;
  const os = platform.getInfo().os;
  const [continueHere, setContinueHere] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const started = useRef(false);

  const shouldRedeem = Boolean(token) && (standalone || continueHere);

  useEffect(() => {
    if (!shouldRedeem || !token || started.current || submittedTokens.has(token)) return;
    started.current = true;
    submittedTokens.add(token);
    setBusy(true);
    onlineService
      .joinWithInvite({ inviteToken: token, eventKey })
      .then((eventId) => navigate(`/events/${eventId}`, { replace: true }))
      .catch((e) => {
        setError(e instanceof Error ? e.message : "پیوستن ناموفق بود");
        setBusy(false);
      });
  }, [shouldRedeem, token, eventKey, navigate]);

  if (!token) {
    return (
      <div className="screen join-page">
        <h1>پیوستن به ایونت</h1>
        <p className="field__error">لینک دعوت معتبر نیست.</p>
        <button type="button" className="form-actions__primary" onClick={() => setJoinSheetOpen(true)}>
          پیوستن با کد دعوت
        </button>
        <JoinWithInviteSheet open={joinSheetOpen} onClose={() => setJoinSheetOpen(false)} />
      </div>
    );
  }

  if (shouldRedeem) {
    return (
      <div className="screen join-page">
        <h1>پیوستن به ایونت</h1>
        {busy && <p>در حال پیوستن و دریافت اطلاعات ایونت…</p>}
        {error && (
          <>
            <p className="field__error">{error}</p>
            <button type="button" className="form-actions__secondary" onClick={() => navigate("/events", { replace: true })}>
              بازگشت به ایونت‌ها
            </button>
          </>
        )}
      </div>
    );
  }

  const steps = {
    android: [
      { icon: <MenuIcon />, text: "در Chrome منوی سه‌نقطه (⋮) را بزنید." },
      { icon: <PlusIcon />, text: "«نصب برنامه» (Install app) یا «افزودن به صفحه‌ی اصلی» (Add to Home screen) را انتخاب کنید." }
    ],
    ios: [
      { icon: <ShareIcon />, text: "در Safari دکمه‌ی اشتراک‌گذاری (Share) را بزنید." },
      { icon: <PlusIcon />, text: "«افزودن به صفحه‌ی اصلی» (Add to Home Screen) را انتخاب کنید." }
    ]
  };
  const sections: { key: "android" | "ios"; title: string }[] = [
    { key: "android", title: "اندروید" },
    { key: "ios", title: "آیفون" }
  ];
  if (os === "ios") sections.reverse();

  return (
    <div className="screen join-page">
      <h1>ابتدا برنامه را نصب کنید</h1>
      <p>برای پیوستن به ایونت، باید برنامه را روی صفحه‌ی اصلی گوشی نصب کنید.</p>

      {sections.map((section) => (
        <div key={section.key} className="online-card">
          <h3>{section.title}</h3>
          <ol className="join-steps">
            {steps[section.key].map((step, index) => (
              <li key={index}>
                {step.icon}
                <span>
                  {index + 1}. {step.text}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {shortCode && (
        <div className="online-card join-code-box">
          <p className="field__hint">کد دعوت شما</p>
          <div className="invite-code">{formatShortCode(shortCode)}</div>
          <button
            type="button"
            className="form-actions__secondary"
            onClick={async () => setToast((await clipboardService.copyText(shortCode)) ? "کد کپی شد" : "کپی انجام نشد")}
          >
            کپی کد
          </button>
        </div>
      )}
      <p>سپس داخل برنامه، «پیوستن با دعوت» را بزنید و این کد را وارد کنید.</p>

      <button type="button" className="form-actions__secondary" onClick={() => setContinueHere(true)}>
        ادامه در همین مرورگر
      </button>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
