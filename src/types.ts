/**
 * Cross DEX Arbitrage Alert - Shared Types
 * Bounty #2: Cross DEX Arbitrage Alert
 */

// Supported chains
export type ChainId = "ethereum" | "arbitrum" | "optimism" | "base" | "polygon";

// Chain configuration
export interface ChainConfig {
  name: ChainId;
  rpcUrl: string;
  blockTimeMs: number;
  nativeToken: string;
  uniswapV2Factory?: string;
  uniswapV3Factory?: string;
  sushiswapV2Factory?: string;
}

// DEX configuration
export interface DexConfig {
  name: "uniswap-v2" | "uniswap-v3" | "sushiswap-v2";
  factory: string;
  router: string;
  quoter?: string; // For V3
  feeBps?: number; // For V3 pools
  chain: ChainId;
}

// Arbitrage request
export interface ArbitrageRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string; // Wei as string
  chains?: ChainId[]; // Chains to scan (default: all)
  minSpreadBps?: number; // Minimum spread to report (default: 50 bps = 0.5%)
  maxHops?: number; // Max hops for multi-hop arbitrage (default: 2)
}

// Route step
export interface RouteStep {
  dex: string;
  poolAddress: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  feeBps: number;
  priceImpactBps: number;
}

// Arbitrage route
export interface ArbitrageRoute {
  steps: RouteStep[];
  netAmountOut: string; // Final amount out after all hops
  netSpreadBps: number; // Net spread in basis points
  estGasCost: string; // Estimated gas cost in wei
  estGasCostUsd: number; // Estimated gas cost in USD
  netProfitUsd: number; // Net profit after gas
  chain: ChainId;
}

// Arbitrage response
export interface ArbitrageResponse {
  bestRoute: ArbitrageRoute | null;
  altRoutes: ArbitrageRoute[];
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  scannedChains: ChainId[];
  scannedDexes: string[];
  warnings: string[];
  timestamp: number;
}

// Health endpoint response
export interface HealthResponse {
  status: "ok" | "degraded";
  chains: Record<ChainId, { configured: boolean; lastBlock?: number }>;
  dexes: Record<string, boolean>;
  timestamp: number;
}

// x402 manifest
export interface X402Manifest {
  x402Version: number;
  resource: string;
  description: string;
  accepts: Array<{
    scheme: "exact";
    network: string;
    asset: string;
    payTo: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
  }>;
  free: string[];
}