/**
 * Cross DEX Arbitrage Alert - x402 Arbitrage Endpoint
 * Bounty #2: Cross DEX Arbitrage Alert
 */

import { ArbitrageRequest, ArbitrageResponse, X402Manifest } from "./types";
import { findArbitrageOpportunities } from "./arbitrage";

const X402_NETWORK = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ORG_EVM_PAYTO = "0x76EfB727cd3271C7DE22f92437Be212766C9631f";

export async function handleArbitrage(request: Request, env: { [key: string]: string }): Promise<Response> {
  try {
    const body: ArbitrageRequest = await request.json();
    
    // Validate required fields
    if (!body.tokenIn || !body.tokenOut || !body.amountIn) {
      return new Response(JSON.stringify({ error: "Missing required fields: tokenIn, tokenOut, amountIn" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Find arbitrage opportunities
    const result = await findArbitrageOpportunities(body);
    
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function handleX402Manifest(): Promise<Response> {
  const manifest: X402Manifest = {
    x402Version: 2,
    resource: "/arbitrage",
    description: "Cross DEX Arbitrage Alert: Detect profitable cross-DEX spreads after fees and gas",
    accepts: [
      {
        scheme: "exact",
        network: X402_NETWORK,
        asset: USDC_BASE,
        payTo: ORG_EVM_PAYTO,
        maxAmountRequired: "10000", // $0.01 in USDC base units
        resource: "/arbitrage",
        description: "One /arbitrage API call",
      },
    ],
    free: ["/health", "/.well-known/x402.json"],
  };
  
  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}