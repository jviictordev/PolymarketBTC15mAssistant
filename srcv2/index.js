import "dotenv/config";
import readline from "node:readline";
import fs from "node:fs";
import Table from "cli-table3";
import { CONFIG } from "./config.js";
import { fetchPositions, fetchActivity, fetchPortfolioValue } from "./wallet.js";
import { sleep, appendCsvRow } from "../src/utils.js";
import { copyPosition } from "./trader/copier.js";
import { getTraderWallet, getOrCreateApiKey } from "./trader/auth.js";
import { fetchBalance } from "./trader/order.js";

const CSV_PATH = "./logs/positions.csv";
const STATE_PATH = "./logs/positions_state.json";
const CSV_HEADER = [
  "timestamp", "status", "market", "outcome",
  "size_usd", "avg_price", "cur_price",
  "unrealized_pnl", "realized_pnl", "end_date",
];

// asset (tokenId) é único por outcome — chave mais estável disponível
function posKey(p) {
  return p.asset ?? p.tokenId ?? `${p.conditionId ?? p.title ?? ""}_${p.outcome ?? ""}`;
}

function writePosRow(p, status) {
  appendCsvRow(CSV_PATH, CSV_HEADER, [
    new Date().toISOString(),
    status,
    p.title ?? p.market ?? "-",
    p.outcome ?? "-",
    Number(p.size ?? 0).toFixed(4),
    Number(p.avgPrice ?? 0).toFixed(4),
    Number(p.curPrice ?? 0).toFixed(4),
    Number(p.cashPnl ?? p.unrealizedPnl ?? 0).toFixed(4),
    Number(p.realizedPnl ?? 0).toFixed(4),
    p.endDate ?? "-",
  ]);
}

// Persiste as chaves conhecidas por carteira para sobreviver restarts
function loadState(wallet) {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return new Set(raw[wallet] ?? []);
  } catch {
    return new Set();
  }
}

function saveState(wallet, knownKeys) {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { /* ok */ }
  raw[wallet] = [...knownKeys];
  fs.mkdirSync("./logs", { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(raw), "utf8");
}

// ─── ANSI ────────────────────────────────────────────────────────────────────
const C = {
  reset:  "\x1b[0m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  cyan:   "\x1b[36m",
  white:  "\x1b[97m",
  gray:   "\x1b[90m",
  dim:    "\x1b[2m",
  bold:   "\x1b[1m",
};

const g = (s) => `${C.green}${s}${C.reset}`;
const r = (s) => `${C.red}${s}${C.reset}`;
const y = (s) => `${C.yellow}${s}${C.reset}`;
const d = (s) => `${C.dim}${C.gray}${s}${C.reset}`;
const w = (s) => `${C.white}${C.bold}${s}${C.reset}`;
const c = (s) => `${C.cyan}${s}${C.reset}`;

function pnlStr(val) {
  const n = Number(val ?? 0);
  if (n > 0) return g(`+$${n.toFixed(2)}`);
  if (n < 0) return r(`-$${Math.abs(n).toFixed(2)}`);
  return "$0.00";
}

function priceStr(val) {
  if (val === null || val === undefined) return d("-");
  const n = Number(val);
  const pct = (n * 100).toFixed(0) + "¢";
  if (n >= 0.6) return g(pct);
  if (n <= 0.4) return r(pct);
  return y(pct);
}

function outcomeStr(outcome) {
  const o = String(outcome ?? "").toLowerCase();
  if (o === "yes" || o === "up")   return g(outcome);
  if (o === "no"  || o === "down") return r(outcome);
  return y(outcome ?? "-");
}

function typeStr(type) {
  const t = String(type ?? "").toUpperCase();
  if (t === "BUY")   return g("BUY");
  if (t === "SELL")  return r("SELL");
  return y(t || "-");
}

function truncate(str, max) {
  const s = String(str ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function fmtDate(iso) {
  if (!iso) return d("-");
  try {
    let ms = typeof iso === "number" ? iso : Number(iso);
    // Se vier em segundos (Unix < ano 3000 em ms), converte
    if (Number.isFinite(ms) && ms < 1e12) ms *= 1000;
    const date = Number.isFinite(ms) ? new Date(ms) : new Date(iso);
    return date.toLocaleString("en-US", {
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false, timeZone: "America/Sao_Paulo",
    });
  } catch { return d("-"); }
}

function renderScreen(text) {
  try {
    readline.cursorTo(process.stdout, 0, 0);
    readline.clearScreenDown(process.stdout);
  } catch { /* ignore */ }
  process.stdout.write(text);
}

// ─── TABLES ──────────────────────────────────────────────────────────────────
function makePositionsTable(openPositions) {
  const table = new Table({
    head: [
      w("Mercado"), w("Lado"), w("Cotas"), w("Valor (USD)"),
      w("Preço Méd"), w("Preço Atu"), w("P&L não real"),
    ],
    colWidths: [44, 8, 10, 14, 12, 12, 16],
    style: { head: [], border: ["gray"] },
    chars: {
      top: "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      left: "│", "left-mid": "├", mid: "─", "mid-mid": "┼",
      right: "│", "right-mid": "┤", middle: "│",
    },
  });

  if (!openPositions.length) {
    table.push([{ colSpan: 7, content: d("  Nenhuma posição aberta."), hAlign: "center" }]);
  } else {
    for (const p of openPositions) {
      const shares = Number(p.size ?? 0);
      const curPrice = Number(p.curPrice ?? 0);
      const valueUsd = shares * curPrice;
      table.push([
        truncate(p.title ?? p.market ?? "-", 42),
        outcomeStr(p.outcome ?? "-"),
        shares.toFixed(2),
        `$${valueUsd.toFixed(2)}`,
        priceStr(p.avgPrice),
        priceStr(p.curPrice),
        pnlStr(p.cashPnl ?? p.unrealizedPnl),
      ]);
    }
  }

  return table.toString();
}

function makeActivityTable(activity) {
  const table = new Table({
    head: [
      w("Data/Hora"), w("Mercado"), w("Tipo"),
      w("Lado"), w("Tamanho"), w("Preço"),
    ],
    colWidths: [18, 40, 8, 8, 12, 10],
    style: { head: [], border: ["gray"] },
    chars: {
      top: "─", "top-mid": "┬", "top-left": "┌", "top-right": "┐",
      bottom: "─", "bottom-mid": "┴", "bottom-left": "└", "bottom-right": "┘",
      left: "│", "left-mid": "├", mid: "─", "mid-mid": "┼",
      right: "│", "right-mid": "┤", middle: "│",
    },
  });

  if (!activity.length) {
    table.push([{ colSpan: 6, content: d("  Sem atividade recente."), hAlign: "center" }]);
  } else {
    for (const a of activity) {
      table.push([
        fmtDate(a.timestamp ?? a.createdAt ?? a.date),
        truncate(a.title ?? a.market ?? a.conditionId ?? "-", 38),
        typeStr(a.type ?? a.side),
        outcomeStr(a.outcome ?? "-"),
        `$${Number(a.size ?? a.usdcSize ?? 0).toFixed(2)}`,
        priceStr(a.price),
      ]);
    }
  }

  return table.toString();
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  if (!CONFIG.walletAddress) {
    console.error("Erro: defina POLYMARKET_WALLET no .env");
    process.exit(1);
  }

  // Inicializa carteira do trader (só se copytrade habilitado)
  let traderWallet = null;
  let traderBalance = null;
  if (CONFIG.copytrade.enabled) {
    try {
      traderWallet = getTraderWallet();
      await getOrCreateApiKey(traderWallet);
      traderBalance = await fetchBalance(traderWallet);
    } catch (err) {
      console.error(`Erro ao inicializar trader: ${err.message}`);
      process.exit(1);
    }
  }

  const walletKey = CONFIG.walletAddress.toLowerCase();
  const knownKeys = loadState(walletKey);
  const knownPositions = new Map();
  let lastCopyLog = [];

  while (true) {
    try {
      const [positions, activity, portfolioValue] = await Promise.all([
        fetchPositions(CONFIG.walletAddress),
        fetchActivity(CONFIG.walletAddress),
        fetchPortfolioValue(CONFIG.walletAddress),
      ]);

      const openPositions = positions.filter((p) => Number(p.size ?? 0) > 0);
      const currentKeys = new Set(openPositions.map(posKey));

      for (const p of openPositions) {
        const key = posKey(p);
        if (!knownKeys.has(key)) {
          writePosRow(p, "OPEN");
          knownKeys.add(key);
          saveState(walletKey, knownKeys);

          // Tenta copiar a posição nova
          if (CONFIG.copytrade.enabled && traderWallet) {
            const result = await copyPosition(p, traderWallet);
            if (result) {
              const msg = result.success
                ? `✅ COPIADO: ${p.outcome} ${p.title?.slice(0, 40)} @ ${(result.price * 100).toFixed(1)}¢ — $${CONFIG.copytrade.amountUsdc}`
                : `❌ ERRO: ${result.error?.slice(0, 60)}`;
              lastCopyLog = [new Date().toLocaleTimeString("en-US", { timeZone: "America/Sao_Paulo", hour12: false }), msg, ...lastCopyLog].slice(0, 5);
            }
          }
        }
        knownPositions.set(key, p);
      }

      for (const [key, p] of knownPositions) {
        if (!currentKeys.has(key)) {
          writePosRow(p, "CLOSED");
          knownKeys.delete(key);
          knownPositions.delete(key);
          saveState(walletKey, knownKeys);
        }
      }

      // Atualiza saldo do trader periodicamente
      if (traderWallet) {
        traderBalance = await fetchBalance(traderWallet);
      }

      const totalPnl  = openPositions.reduce((acc, p) => acc + Number(p.cashPnl ?? p.unrealizedPnl ?? 0), 0);
      const now       = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "America/Sao_Paulo" });
      const addrShort = `${CONFIG.walletAddress.slice(0, 8)}...${CONFIG.walletAddress.slice(-6)}`;

      const copyStatusLine = CONFIG.copytrade.enabled
        ? `  ${w("COPYTRADE:")} ${g("ATIVO")}  ${w("Saldo trader:")} ${traderBalance !== null ? c("$" + traderBalance.toFixed(2)) : d("-")}  ${w("Por trade:")} ${c("$" + CONFIG.copytrade.amountUsdc)}  ${w("Max entrada:")} ${c((CONFIG.copytrade.maxEntryPrice * 100).toFixed(0) + "¢")}`
        : `  ${w("COPYTRADE:")} ${d("DESATIVADO — defina COPYTRADE_ENABLED=true no .env")}`;

      const copyLogLines = lastCopyLog.length
        ? ["", `  ${w("ÚLTIMAS CÓPIAS")}`, ...lastCopyLog.map((l, i) => i % 2 === 0 ? `  ${d(l)}` : `  ${l}`)]
        : [];

      const output = [
        "",
        `  ${w("POLYMARKET WALLET")}  ${d(addrShort)}  ${d(now)}`,
        copyStatusLine,
        "",
        `  ${w("Portfólio alvo:")}  ${portfolioValue !== null ? c("$" + Number(portfolioValue).toFixed(2)) : d("-")}   ${w("P&L aberto:")}  ${pnlStr(totalPnl)}`,
        "",
        `  ${w(`POSIÇÕES ABERTAS (${openPositions.length})`)}`,
        makePositionsTable(openPositions),
        "",
        `  ${w(`ATIVIDADE RECENTE (${activity.length})`)}`,
        makeActivityTable(activity),
        ...copyLogLines,
        "",
        d(`  Atualiza a cada ${CONFIG.pollIntervalMs / 1000}s  •  Ctrl+C para sair`),
        "",
      ].join("\n");

      renderScreen(output);
    } catch (err) {
      renderScreen(`\n  ${r("Erro:")} ${err?.message ?? String(err)}\n  ${d("Tentando novamente em " + CONFIG.pollIntervalMs / 1000 + "s...")}\n`);
    }

    await sleep(CONFIG.pollIntervalMs);
  }
}

main();
