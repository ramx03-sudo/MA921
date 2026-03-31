// Central config — reads from environment in production, falls back to localhost in dev
const BACKEND_HOST = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:8000";
const WS_HOST      = BACKEND_HOST.replace("https://", "wss://").replace("http://", "ws://");

export const API_URL = BACKEND_HOST;
export const WS_URL  = `${WS_HOST}/ws/live`;
