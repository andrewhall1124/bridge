// Client-side Web Push: subscribe/unsubscribe the browser and register the
// subscription with the backend. Requires a secure context (HTTPS or
// localhost) and the service worker registered in main.tsx.

import { api } from "./api";

export interface PushState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) {
    return { supported: false, permission: "denied", subscribed: false };
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return {
    supported: true,
    permission: Notification.permission,
    subscribed: sub != null,
  };
}

export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) throw new Error("Push is not supported in this browser.");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { supported: true, permission, subscribed: false };
  }

  const { publicKey } = await api.getVapidPublicKey();
  if (!publicKey) throw new Error("Server has no VAPID key configured.");

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  await api.subscribePush(sub.toJSON());
  return { supported: true, permission, subscribed: true };
}

export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) {
    return { supported: false, permission: "denied", subscribed: false };
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.unsubscribePush(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  return { supported: true, permission: Notification.permission, subscribed: false };
}
