import { clamp } from "../utils.js";

export function scoreDirection(inputs) {
  const {
    price,
    vwap,
    vwapSlope,
    rsi,
    rsiSlope,
    macd,
    heikenColor,
    heikenCount,
    failedVwapReclaim,
    marketUp,
    marketDown
  } = inputs;

  let up = 1;
  let down = 1;

  // Polymarket consensus — peso dominante (agrega informação de muitos participantes)
  // Os preços já são decimais 0-1 (ex: 0.46 = 46¢). Normaliza para remover o vig.
  if (marketUp !== null && marketDown !== null && Number.isFinite(marketUp) && Number.isFinite(marketDown)) {
    const sum = marketUp + marketDown;
    if (sum > 0) {
      const normUp = marketUp / sum;
      const normDown = marketDown / sum;
      // Peso proporcional à convicção: sempre entra, mais peso quanto mais extremo
      up += normUp * 8;
      down += normDown * 8;
    }
  }

  if (price !== null && vwap !== null) {
    if (price > vwap) up += 2;
    if (price < vwap) down += 2;
  }

  if (vwapSlope !== null) {
    if (vwapSlope > 0) up += 2;
    if (vwapSlope < 0) down += 2;
  }

  if (rsi !== null) {
    // Sobrecomprado: sinal de reversão para baixo
    if (rsi > 70) down += 2;
    // Sobrevendido: sinal de reversão para cima
    else if (rsi < 30) up += 2;
    // Tendência normal
    else if (rsiSlope !== null) {
      if (rsi > 55 && rsiSlope > 0) up += 2;
      if (rsi < 45 && rsiSlope < 0) down += 2;
    }
  }

  if (macd?.hist !== null && macd?.histDelta !== null) {
    const expandingGreen = macd.hist > 0 && macd.histDelta > 0;
    const expandingRed = macd.hist < 0 && macd.histDelta < 0;
    if (expandingGreen) up += 2;
    if (expandingRed) down += 2;

    if (macd.macd > 0) up += 1;
    if (macd.macd < 0) down += 1;
  }

  if (heikenColor) {
    if (heikenColor === "green" && heikenCount >= 2) up += 1;
    if (heikenColor === "red" && heikenCount >= 2) down += 1;
  }

  if (failedVwapReclaim === true) down += 3;

  const rawUp = up / (up + down);
  return { upScore: up, downScore: down, rawUp };
}

export function applyTimeAwareness(rawUp, remainingMinutes, windowMinutes) {
  const timeDecay = clamp(remainingMinutes / windowMinutes, 0, 1);
  const adjustedUp = clamp(0.5 + (rawUp - 0.5) * timeDecay, 0, 1);
  return { timeDecay, adjustedUp, adjustedDown: 1 - adjustedUp };
}
