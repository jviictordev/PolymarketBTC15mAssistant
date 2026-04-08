import { ethers } from "ethers";
import { CONFIG } from "../config.js";
import { buildL1Headers } from "./auth.js";

// Contrato CTF Exchange na Polygon (usado pela maioria dos mercados Polymarket)
const CTF_EXCHANGE = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
const NEG_RISK_CTF_EXCHANGE = "0xC5d563A36AE78145C45a50134d48A1215220f80a";
const CHAIN_ID = 137; // Polygon

const ORDER_EIP712_TYPES = {
  Order: [
    { name: "salt",          type: "uint256" },
    { name: "maker",         type: "address" },
    { name: "signer",        type: "address" },
    { name: "taker",         type: "address" },
    { name: "tokenId",       type: "uint256" },
    { name: "makerAmount",   type: "uint256" },
    { name: "takerAmount",   type: "uint256" },
    { name: "expiration",    type: "uint256" },
    { name: "nonce",         type: "uint256" },
    { name: "feeRateBps",    type: "uint256" },
    { name: "side",          type: "uint8"   },
    { name: "signatureType", type: "uint8"   },
  ],
};

function buildDomain(negRisk = false) {
  return {
    name:              "ClobAuthDomain",
    version:           "1",
    chainId:           CHAIN_ID,
    verifyingContract: negRisk ? NEG_RISK_CTF_EXCHANGE : CTF_EXCHANGE,
  };
}

/**
 * Monta e assina uma ordem de compra (BUY) no formato EIP-712.
 *
 * @param {ethers.Wallet} wallet  - Carteira do trader
 * @param {string}        tokenId - Token ID do outcome (asset)
 * @param {number}        price   - Preço limite (0–1)
 * @param {number}        amountUsdc - Valor em USDC a gastar
 * @param {boolean}       negRisk - Se é mercado NegRisk
 */
export async function buildBuyOrder(wallet, tokenId, price, amountUsdc, negRisk = false) {
  const USDC_DECIMALS = 1_000_000n; // USDC tem 6 casas decimais

  const makerAmount = BigInt(Math.round(amountUsdc * 1_000_000)); // USDC gasto
  const takerAmount = BigInt(Math.round((amountUsdc / price) * 1_000_000)); // shares recebidos

  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  const orderStruct = {
    salt,
    maker:         wallet.address,
    signer:        wallet.address,
    taker:         "0x0000000000000000000000000000000000000000",
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    0n,
    nonce:         0n,
    feeRateBps:    0n,
    side:          0,  // 0 = BUY
    signatureType: 0,  // 0 = EOA
  };

  const domain = buildDomain(negRisk);
  const signature = await wallet.signTypedData(domain, ORDER_EIP712_TYPES, orderStruct);

  return {
    salt:          salt.toString(),
    maker:         orderStruct.maker,
    signer:        orderStruct.signer,
    taker:         orderStruct.taker,
    tokenId:       tokenId,
    makerAmount:   makerAmount.toString(),
    takerAmount:   takerAmount.toString(),
    expiration:    "0",
    nonce:         "0",
    feeRateBps:    "0",
    side:          "BUY",
    signatureType: "EOA",
    signature,
  };
}

/**
 * Envia uma ordem para o CLOB do Polymarket.
 */
export async function submitOrder(wallet, order) {
  const headers = await buildL1Headers(wallet);

  const res = await fetch(`${CONFIG.clobBaseUrl}/order`, {
    method:  "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body:    JSON.stringify({ order, orderType: "FOK" }), // Fill-or-Kill: executa tudo ou nada
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Ordem rejeitada: ${res.status} — ${JSON.stringify(body)}`);
  }

  return body;
}

/**
 * Consulta o saldo de USDC disponível na carteira do trader via CLOB.
 */
export async function fetchBalance(wallet) {
  try {
    const headers = await buildL1Headers(wallet);
    const res = await fetch(`${CONFIG.clobBaseUrl}/balance-allowance?asset_type=USDC`, {
      headers,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Number(data?.balance ?? 0) / 1_000_000; // converte de unidades USDC
  } catch {
    return null;
  }
}
