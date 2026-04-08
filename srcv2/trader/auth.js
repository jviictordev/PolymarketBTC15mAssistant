import { ethers } from "ethers";
import fs from "node:fs";
import { CONFIG } from "../config.js";

const API_KEY_PATH = "./logs/clob_api_key.json";

/**
 * Gera os headers de autenticação L1 (usados para criar/buscar a API key).
 * Polymarket autentica assinando um hash de timestamp+nonce com a chave privada.
 */
export async function buildL1Headers(wallet, nonce = 0) {
  const timestamp = Math.floor(Date.now() / 1000);
  const hash = ethers.solidityPackedKeccak256(
    ["uint256", "uint256"],
    [timestamp, nonce]
  );
  const signature = await wallet.signMessage(ethers.getBytes(hash));

  return {
    "POLY_ADDRESS":   wallet.address,
    "POLY_SIGNATURE": signature,
    "POLY_TIMESTAMP": String(timestamp),
    "POLY_NONCE":     String(nonce),
    "Content-Type":   "application/json",
  };
}

/**
 * Gera os headers de autenticação L2 (usados em todas as ordens).
 */
export function buildL2Headers(apiKey, secret, passphrase) {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    "POLY_ADDRESS":    apiKey.address ?? "",
    "POLY_API_KEY":    apiKey.apiKey,
    "POLY_SECRET":     secret,
    "POLY_PASSPHRASE": passphrase,
    "POLY_TIMESTAMP":  String(timestamp),
    "Content-Type":    "application/json",
  };
}

/**
 * Busca ou cria a API key L2 do CLOB, persistindo em disco.
 */
export async function getOrCreateApiKey(wallet) {
  // Tenta carregar do disco primeiro
  try {
    const stored = JSON.parse(fs.readFileSync(API_KEY_PATH, "utf8"));
    if (stored?.apiKey && stored?.secret && stored?.passphrase) {
      return stored;
    }
  } catch { /* não existe ainda */ }

  const headers = await buildL1Headers(wallet);

  // Tenta buscar uma key existente
  const getRes = await fetch(`${CONFIG.clobBaseUrl}/auth/api-key`, {
    method: "GET",
    headers,
  });

  if (getRes.ok) {
    const data = await getRes.json();
    if (data?.apiKey) {
      fs.mkdirSync("./logs", { recursive: true });
      fs.writeFileSync(API_KEY_PATH, JSON.stringify(data), "utf8");
      return data;
    }
  }

  // Cria nova key
  const createRes = await fetch(`${CONFIG.clobBaseUrl}/auth/api-key`, {
    method: "POST",
    headers,
  });

  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Falha ao criar API key: ${createRes.status} ${body}`);
  }

  const data = await createRes.json();
  fs.mkdirSync("./logs", { recursive: true });
  fs.writeFileSync(API_KEY_PATH, JSON.stringify(data), "utf8");
  return data;
}

/**
 * Inicializa a wallet do trader a partir da chave privada no .env
 */
export function getTraderWallet() {
  if (!CONFIG.privateKey) throw new Error("TRADER_PRIVATE_KEY não definida no .env");
  return new ethers.Wallet(CONFIG.privateKey);
}
