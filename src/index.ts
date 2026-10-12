/**
 * Cross DEX Arbitrage Alert - Main Entry Point
 * Bounty #2: Cross DEX Arbitrage Alert
 * Cloudflare Worker with x402 payment gating
 */

import { Hono } from "hono";
import { paymentMiddleware } from "x402-hono";
import { handleHealth } from "./health";
import { handleArbitrage, handleX402Manifest } from "./arbitrage_endpoint";

type Bindings = {
  ORG_EVM_PAYTO: string;
  ETHEREUM_RPC_URL: string;
  ARBITRUM_RPC_URL: string;
  OPTIMISM_RPC_URL: string;
  BASE_RPC_URL: string;
  POLYGON_RPC_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Free endpoints
app.get("/health", async (c) => {
  const health = await handleHealth(c.env);
  return c.json(health);
});

app.get("/.well-known/x402.json", async (c) => {
  return handleX402Manifest();
});

// Paid endpoint with x402
app.use("/arbitrage", async (c, next) => {
  const mw = paymentMiddleware(c.env.ORG_EVM_PAYTO as `0x${string}`, {
    "/arbitrage": {
      price: "$0.01",
      network: "base",
      config: {
        description: "Cross DEX Arbitrage Alert: Profitable spreads after fees and gas",
      },
    },
  });
  return mw(c, next);
});

app.post("/arbitrage", async (c) => {
  return handleArbitrage(c.req.raw, c.env);
});

export default app;