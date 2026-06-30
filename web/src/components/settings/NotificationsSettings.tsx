import { useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  getPushState,
  pushSupported,
  type PushState,
} from "../../push";

export function NotificationsSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  async function toggle(enable: boolean) {
    setBusy(true);
    setError(null);
    try {
      setState(enable ? await enablePush() : await disablePush());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!pushSupported()) {
    return (
      <div className="system-line">
        Push notifications aren’t supported in this browser. Install Bridge as an
        app (Add to Home Screen) and open it over HTTPS to enable them.
      </div>
    );
  }

  const subscribed = state?.subscribed ?? false;
  const denied = state?.permission === "denied";

  return (
    <>
      <div className="field">
        <span>Push notifications</span>
        <p className="subtle" style={{ margin: "4px 0 10px" }}>
          Get a notification when a session needs your input, finishes, or hits
          an error — on this device, even when Bridge is in the background.
        </p>
        {denied && !subscribed ? (
          <span className="system-line error">
            Notifications are blocked in your browser settings for this site.
            Re-allow them, then enable here.
          </span>
        ) : (
          <button
            className={`btn ${subscribed ? "" : "btn-primary"}`}
            onClick={() => void toggle(!subscribed)}
            disabled={busy}
          >
            {busy
              ? "…"
              : subscribed
                ? "Disable on this device"
                : "Enable on this device"}
          </button>
        )}
        {error && (
          <span className="system-line error" style={{ marginTop: 8 }}>
            {error}
          </span>
        )}
      </div>
    </>
  );
}
