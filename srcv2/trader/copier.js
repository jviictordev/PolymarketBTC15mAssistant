import { CONFIG } from "../config.js";
import { appendCsvRow } from "../../src/utils.js";
import { buildBuyOrder, submitOrder, fetchBalance } from "./order.js";

const TRADES_CSV = "./logs/my_trades.csv";
const TRADES_HEADER = [
  "timestamp", "status", "market", "outcome", "token_id",
  "amount_usdc", "price", "shares", "order_id", "reason",
];

function logTrade(fields) {
  appendCsvRow(TRADES_CSV, TRADES_HEADER, [
    new Date().toISOString(),
    fields.status,
    fields.market ?? "-",
    fields.outcome ?? "-",
    fields.tokenId ?? "-",
    fields.amountUsdc ?? "-",
    fields.price ?? "-",
    fields.shares ?? "-",
    fields.orderId ?? "-",
    fields.reason ?? "-",
  ]);
}

/**
 * Retorna o preço atual de um token via CLOB.
 */
async function fetchCurrentPrice(tokenId) {
  try {
    const url = `${CONFIG.clobBaseUrl}/price?token_id=${tokenId}&side=buy`;
    const res = await fetch(url, { headers: { "User-Agent": "CopyBot/1.0" } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.price ? Number(data.price) : null;
  } catch {
    return null;
  }
}

/**
 * Avalia uma posição detectada e decide se copia.
 * Retorna { shouldCopy, reason }
 */
async function evaluate(position, wallet) {
  const cfg = CONFIG.copytrade;
  const entryPrice = Number(position.avgPrice ?? 0);
  const tokenId    = position.asset ?? position.tokenId;

  if (!tokenId) return { shouldCopy: false, reason: "sem_token_id" };

  // Proteção 1: preço de entrada da carteira alvo deve ser long-shot
  if (entryPrice > cfg.maxEntryPrice) {
    return { shouldCopy: false, reason: `preco_entrada_alto_${(entryPrice * 100).toFixed(1)}c` };
  }

  // Proteção 2: busca o preço atual — rejeita se já subiu muito (slippage)
  const currentPrice = await fetchCurrentPrice(tokenId);
  if (currentPrice === null) return { shouldCopy: false, reason: "preco_atual_indisponivel" };

  if (currentPrice > cfg.maxSlippagePrice) {
    return { shouldCopy: false, reason: `slippage_${(currentPrice * 100).toFixed(1)}c` };
  }

  // Proteção 3: verifica saldo suficiente (usa o maior valor possível como referência)
  const maxAmount = Math.max(cfg.amountUsdc, cfg.largeAmountUsdc);
  const balance = await fetchBalance(wallet);
  if (balance !== null && balance < cfg.amountUsdc) {
    return { shouldCopy: false, reason: `saldo_insuficiente_$${balance?.toFixed(4)}` };
  }

  // Calcula o valor USD da aposta do alvo: shares × avgPrice
  const targetEntryUsd = Number(position.size ?? 0) * Number(position.avgPrice ?? 0);
  const isLargeBet = targetEntryUsd >= cfg.largeEntryUsd;

  return { shouldCopy: true, reason: "ok", currentPrice, isLargeBet, targetEntryUsd };
}

/**
 * Tenta copiar uma posição. Chame quando detectar um novo OPEN na carteira alvo.
 */
export async function copyPosition(position, wallet) {
  if (!CONFIG.copytrade.enabled) return;

  const market  = position.title ?? position.market ?? "-";
  const outcome = position.outcome ?? "-";
  const tokenId = position.asset ?? position.tokenId;

  const { shouldCopy, reason, currentPrice, isLargeBet, targetEntryUsd } = await evaluate(position, wallet);

  if (!shouldCopy) {
    logTrade({ status: "SKIPPED", market, outcome, tokenId, reason });
    return;
  }

  const price     = currentPrice;
  const amountUsdc = isLargeBet
    ? CONFIG.copytrade.largeAmountUsdc   // $0.50 — alvo apostou grande
    : CONFIG.copytrade.amountUsdc;       // $0.10 — aposta padrão
  const shares = amountUsdc / price;
  const betLabel = isLargeBet
    ? `LARGE ($${targetEntryUsd.toFixed(0)} alvo → $${amountUsdc.toFixed(2)} cópia)`
    : `NORMAL ($${targetEntryUsd.toFixed(0)} alvo → $${amountUsdc.toFixed(2)} cópia)`;

  try {
    const negRisk = Boolean(position.negRisk);
    const order   = await buildBuyOrder(wallet, tokenId, price, amountUsdc, negRisk);
    const result  = await submitOrder(wallet, order);

    logTrade({
      status:    "FILLED",
      market,
      outcome,
      tokenId,
      amountUsdc: amountUsdc.toFixed(4),
      price:      price.toFixed(4),
      shares:     shares.toFixed(2),
      orderId:    result?.orderID ?? result?.id ?? "-",
      reason:     betLabel,
    });

    return { success: true, price, shares, amountUsdc, orderId: result?.orderID ?? result?.id };

  } catch (err) {
    logTrade({
      status:    "ERROR",
      market,
      outcome,
      tokenId,
      amountUsdc: CONFIG.copytrade.amountUsdc.toFixed(2),
      price:      price.toFixed(4),
      shares:     shares.toFixed(2),
      reason:     err?.message?.slice(0, 120) ?? "erro_desconhecido",
    });

    return { success: false, error: err?.message };
  }
}
