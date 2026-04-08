import "dotenv/config";

export const CONFIG = {
  // Carteira monitorada (alvo do copytrade)
  walletAddress: process.env.POLYMARKET_WALLET || "",

  // Sua carteira (executa as ordens)
  privateKey: process.env.TRADER_PRIVATE_KEY || "",

  pollIntervalMs: 3_000,
  activityLimit: 20,

  dataApiUrl: "https://data-api.polymarket.com",
  gammaBaseUrl: "https://gamma-api.polymarket.com",
  clobBaseUrl: "https://clob.polymarket.com",

  copytrade: {
    enabled: (process.env.COPYTRADE_ENABLED || "false") === "true",

    // Valor padrão por trade ($0.10)
    amountUsdc: 0.10,

    // Quando o alvo aposta acima de largeEntryUsd, usa este valor ($0.50)
    largeAmountUsdc: 0.50,

    // Threshold para considerar aposta "grande" do alvo (valor em USD = shares × avgPrice)
    largeEntryUsd: 100,

    // Só copia se o preço de entrada for <= este valor (em fração, ex: 0.05 = 5¢)
    maxEntryPrice: Number(process.env.COPY_MAX_ENTRY_PRICE || "0.05"),

    // Não copia se o preço já subiu acima deste threshold desde a entrada do alvo
    maxSlippagePrice: Number(process.env.COPY_MAX_SLIPPAGE || "0.08"),

    // Não copia se o mercado tem menos de X minutos para fechar
    minTimeLeftMin: Number(process.env.COPY_MIN_TIME_LEFT_MIN || "2"),
  },
};
