import { CONFIG } from "./config.js";

const HEADERS = { "User-Agent": "PolyWalletBot/1.0" };

async function apiFetch(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchPositions(address) {
  const url = `${CONFIG.dataApiUrl}/positions?user=${address}&sortBy=CURRENT&sortDirection=DESC&sizeThreshold=.1&limit=30&offset=0`;
  const data = await apiFetch(url);
  return Array.isArray(data) ? data : [];
}

export async function fetchActivity(address) {
  const url = `${CONFIG.dataApiUrl}/activity?user=${address}&limit=${CONFIG.activityLimit}`;
  const data = await apiFetch(url);
  return Array.isArray(data) ? data : [];
}

export async function fetchPortfolioValue(address) {
  try {
    const url = `${CONFIG.dataApiUrl}/value?user=${address}`;
    const data = await apiFetch(url);
    const user_data = data && Array.isArray(data) ? data[0] : null;
    return user_data?.value ?? null;
  } catch {
    return null;
  }
}
