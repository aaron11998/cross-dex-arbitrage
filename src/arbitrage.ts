/**
 * Cross DEX Arbitrage Alert - Arbitrage Calculation Engine
 * Bounty #2: Cross DEX Arbitrage Alert
 */

import { ethers } from "ethers";
import { ArbitrageRequest, ArbitrageResponse, ArbitrageRoute, RouteStep, DexConfig, ChainConfig, ChainId } from "./types";
import { getDexesForChain, getChainConfig } from "./chains";

// ERC20 ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

// Uniswap V2 Router ABI
const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)",
];

// Uniswap V3 Quoter ABI
const V3_QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)",
];

// V2 Pair ABI for reserves
const V2_PAIR_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// Gas estimates (in gas units)
const GAS_ESTIMATES = {
  "uniswap-v2": 150000,
  "uniswap-v3": 200000,
  "sushiswap-v2": 160000,
};

async function getV2Quote(
  provider: ethers.JsonRpcProvider,
  routerAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string
): Promise<{ amountOut: string; gasEstimate: number } | null> {
  try {
    const router = new ethers.Contract(routerAddress, V2_ROUTER_ABI, provider);
    const path = [tokenIn, tokenOut];
    const amounts = await router.getAmountsOut(amountIn, path);
    return {
      amountOut: amounts[1].toString(),
      gasEstimate: GAS_ESTIMATES["uniswap-v2"],
    };
  } catch {
    return null;
  }
}

async function getV3Quote(
  provider: ethers.JsonRpcProvider,
  quoterAddress: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  feeBps: number
): Promise<{ amountOut: string; gasEstimate: number } | null> {
  try {
    const quoter = new ethers.Contract(quoterAddress, V3_QUOTER_ABI, provider);
    const fee = feeBps * 100; // Convert bps to fee tier (30 bps = 3000)
    const amountOut = await quoter.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);
    return {
      amountOut: amountOut.toString(),
      gasEstimate: GAS_ESTIMATES["uniswap-v3"],
    };
  } catch {
    return null;
  }
}

async function getTokenDecimals(
  provider: ethers.JsonRpcProvider,
  tokenAddress: string
): Promise<number> {
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    return await token.decimals();
  } catch {
    return 18; // Default
  }
}

async function getTokenPriceUsd(
  tokenAddress: string,
  chain: ChainId
): Promise<number> {
  // Simplified - in production, use a price oracle or DEX quote against USDC
  // For now, return 1 for stablecoins, 0 for others
  const stablecoins = {
    ethereum: ["0xA0b86a33E6441b8C4505B0e33B4A5d4D8F6c6d12", "0x6B175474E89094C44Da98b954EedeAC495271d0F"], // USDC, DAI
    arbitrum: ["0xaf88d065e77c8cC2239327C5EDb3A432268e5831", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"], // USDC, DAI
    optimism: ["0x7F5c764cBc14f9669B88837ca1490cCa17c31607", "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"], // USDC, DAI
    base: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb"], // USDC, DAI
    polygon: ["0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"], // USDC, DAI
  };
  
  if (stablecoins[chain]?.includes(tokenAddress.toLowerCase())) {
    return 1.0;
  }
  return 0; // Unknown price
}

function estimateGasCostUsd(gasUnits: number, chain: ChainId): number {
  // Simplified gas cost estimation
  const gasPricesGwei = {
    ethereum: 20,
    arbitrum: 0.1,
    optimism: 0.1,
    base: 0.1,
    polygon: 30,
  };
  
  const nativePricesUsd = {
    ethereum: 2600,
    arbitrum: 2600,
    optimism: 2600,
    base: 2600,
    polygon: 0.8,
  };
  
  const gasPriceGwei = gasPricesGwei[chain] || 20;
  const nativePrice = nativePricesUsd[chain] || 2600;
  
  const gasCostWei = BigInt(gasUnits) * BigInt(gasPriceGwei * 1e9);
  const gasCostEth = Number(gasCostWei) / 1e18;
  return gasCostEth * nativePrice;
}

async function findDirectArbitrage(
  provider: ethers.JsonRpcProvider,
  dexA: DexConfig,
  dexB: DexConfig,
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
  chain: ChainId
): Promise<ArbitrageRoute | null> {
  try {
    // Get quote from DEX A (tokenIn -> tokenOut)
    let quoteA: { amountOut: string; gasEstimate: number } | null = null;
    if (dexA.name === "uniswap-v2" || dexA.name === "sushiswap-v2") {
      quoteA = await getV2Quote(provider, dexA.router, tokenIn, tokenOut, amountIn);
    } else if (dexA.name === "uniswap-v3") {
      quoteA = await getV3Quote(provider, dexA.quoter!, tokenIn, tokenOut, amountIn, dexA.feeBps || 3000);
    }
    
    if (!quoteA) return null;
    
    // Get quote from DEX B (tokenOut -> tokenIn) - reverse direction
    let quoteB: { amountOut: string; gasEstimate: number } | null = null;
    if (dexB.name === "uniswap-v2" || dexB.name === "sushiswap-v2") {
      quoteB = await getV2Quote(provider, dexB.router, tokenOut, tokenIn, quoteA.amountOut);
    } else if (dexB.name === "uniswap-v3") {
      quoteB = await getV3Quote(provider, dexB.quoter!, tokenOut, tokenIn, quoteA.amountOut, dexB.feeBps || 3000);
    }
    
    if (!quoteB) return null;
    
    // Calculate net profit
    const amountInNum = parseFloat(amountIn);
    const amountOutNum = parseFloat(quoteB.amountOut);
    const profit = amountOutNum - amountInNum;
    
    if (profit <= 0) return null;
    
    const spreadBps = Math.round((profit / amountInNum) * 10000);
    const totalGas = quoteA.gasEstimate + quoteB.gasEstimate;
    const gasCostUsd = estimateGasCostUsd(totalGas, chain);
    
    // Get token prices for USD calculation
    const tokenInPrice = await getTokenPriceUsd(tokenIn, chain);
    const tokenOutPrice = await getTokenPriceUsd(tokenOut, chain);
    const amountInUsd = tokenInPrice > 0 ? (amountInNum / 1e18) * tokenInPrice : 0;
    const profitUsd = tokenOutPrice > 0 ? (profit / 1e18) * tokenOutPrice : 0;
    const netProfitUsd = profitUsd - gasCostUsd;
    
    if (netProfitUsd <= 0) return null;
    
    return {
      steps: [
        {
          dex: dexA.name,
          poolAddress: "0x0", // Would need pool lookup
          tokenIn,
          tokenOut,
          amountIn,
          amountOut: quoteA.amountOut,
          feeBps: dexA.feeBps || 30,
          priceImpactBps: 0,
        },
        {
          dex: dexB.name,
          poolAddress: "0x0",
          tokenIn: tokenOut,
          tokenOut: tokenIn,
          amountIn: quoteA.amountOut,
          amountOut: quoteB.amountOut,
          feeBps: dexB.feeBps || 30,
          priceImpactBps: 0,
        },
      ],
      netAmountOut: quoteB.amountOut,
      netSpreadBps: spreadBps,
      estGasCost: (BigInt(quoteA.gasEstimate) + BigInt(quoteB.gasEstimate)).toString(),
      estGasCostUsd: gasCostUsd,
      netProfitUsd,
      chain,
    };
  } catch {
    return null;
  }
}

export async function findArbitrageOpportunities(request: ArbitrageRequest): Promise<ArbitrageResponse> {
  const chains = request.chains || ["ethereum", "arbitrum", "optimism", "base", "polygon"];
  const minSpreadBps = request.minSpreadBps || 50; // 0.5% default
  
  const allRoutes: ArbitrageRoute[] = [];
  const warnings: string[] = [];
  const scannedDexes: string[] = [];
  const scannedChains: ChainId[] = [];
  
  for (const chain of chains) {
    const chainConfig = getChainConfig(chain);
    if (!chainConfig.rpcUrl) {
      warnings.push(`${chain}: RPC URL not configured`);
      continue;
    }
    
    scannedChains.push(chain);
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const dexes = getDexesForChain(chain);
    
    // Check all pairs of DEXes for arbitrage
    for (let i = 0; i < dexes.length; i++) {
      for (let j = i + 1; j < dexes.length; j++) {
        const dexA = dexes[i];
        const dexB = dexes[j];
        
        scannedDexes.push(`${dexA.name}-${chain}`, `${dexB.name}-${chain}`);
        
        // Check both directions
        const route1 = await findDirectArbitrage(provider, dexA, dexB, request.tokenIn, request.tokenOut, request.amountIn, chain);
        const route2 = await findDirectArbitrage(provider, dexB, dexA, request.tokenIn, request.tokenOut, request.amountIn, chain);
        
        if (route1 && route1.netSpreadBps >= minSpreadBps) {
          allRoutes.push(route1);
        }
        if (route2 && route2.netSpreadBps >= minSpreadBps) {
          allRoutes.push(route2);
        }
      }
    }
  }
  
  // Sort by net profit descending
  allRoutes.sort((a, b) => b.netProfitUsd - a.netProfitUsd);
  
  const bestRoute = allRoutes.length > 0 ? allRoutes[0] : null;
  const altRoutes = allRoutes.slice(1, 5); // Top 5 alternatives
  
  if (allRoutes.length === 0) {
    warnings.push("No profitable arbitrage routes found above minimum spread threshold");
  }
  
  return {
    bestRoute,
    altRoutes,
    tokenIn: request.tokenIn,
    tokenOut: request.tokenOut,
    amountIn: request.amountIn,
    scannedChains,
    scannedDexes: [...new Set(scannedDexes)],
    warnings,
    timestamp: Date.now(),
  };
}

export type { ArbitrageRoute, RouteStep };