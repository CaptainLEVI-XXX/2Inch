# 1inch Limit Order Protocol Extension - Dynamic Spread Limit Order

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.19+-363636?logo=solidity)](https://soliditylang.org/)

> Dynamic pricing for limit orders based on real-time market volatility

## Overview

The Volatility Spread Extension enhances the 1inch Limit Order Protocol by introducing market-adaptive pricing through real-time volatility analysis. This extension enables sophisticated market-making strategies that automatically adjust spreads based on market conditions, reducing risk during volatile periods while maintaining competitive pricing during stable markets.


## Quick Start

### Basic Usage

```typescript
import { VolatilitySdk, Address, parseEther, parseUnits } from '@1inch/limit-order-sdk';
import { JsonRpcProvider } from 'ethers';

// Initialize SDK
const provider = new JsonRpcProvider(process.env.RPC_URL);
const volatilitySdk = new VolatilitySdk({
  provider,
  volatilityContractAddress: process.env.VOLATILITY_CONTRACT_ADDRESS
});

// Create order with volatility spread
const order = await volatilitySdk.createOrder({
  maker: new Address(wallet.address),
  makerAsset: new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'), // WETH
  takerAsset: new Address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'), // USDC
  makingAmount: ONE_ETH,
  takingAmount: parseUnits('3000', 6)
}, {
  baseSpreadBps: 50,         // 0.5% base spread
  volatilityMultiplier: 200,  // 2x volatility impact
  maxSpreadBps: 300,         // 3% maximum spread
  volatilityWindow: 0,        // 24-hour volatility
  useTargetToken: false       // Use taker asset for volatility
});

// Sign and submit
const signature = await wallet.signTypedData(
  order.getTypedData(chainId).domain,
  { Order: order.getTypedData(chainId).types.Order },
  order.getTypedData(chainId).message
);
```

### Advanced Configuration

```typescript
// Custom spread strategies
const conservativeParams = {
  baseSpreadBps: 25,         // 0.25% - tight base spread
  volatilityMultiplier: 100,  // 1x - moderate volatility response
  maxSpreadBps: 150,         // 1.5% - capped maximum
  volatilityWindow: 1,        // 7-day average for stability
  useTargetToken: true       // Use maker asset volatility
};

const aggressiveParams = {
  baseSpreadBps: 100,        // 1% - wider base spread
  volatilityMultiplier: 500,  // 5x - high volatility response
  maxSpreadBps: 1000,        // 10% - high maximum
  volatilityWindow: 0,        // 24h for quick response
  useTargetToken: false      // Use taker asset volatility
};

// Preview spread before creating order
const preview = await volatilitySdk.previewVolatility(
  makerAsset,
  takerAsset,
  conservativeParams
);

console.log(`Current volatility: ${preview.currentVolatility / 100}%`);
console.log(`Dynamic spread: ${preview.dynamicSpread / 100}%`);
```


### SpreadParams

Configuration for volatility-based spread calculation.

```typescript
interface SpreadParams {
  baseSpreadBps: number;        // Base spread in basis points (1-10000)
  volatilityMultiplier: number; // Volatility impact multiplier (1-10000)
  maxSpreadBps: number;         // Maximum allowed spread (1-10000)
  volatilityWindow: 0 | 1 | 2;  // 0=24h, 1=7d, 2=blended
  useTargetToken: boolean;      // true=makerAsset, false=takerAsset
}
```

## Smart Contracts

### VolatilitySpreadCalculator

The core contract implementing dynamic spread calculation.

## Testing

// all test written in fork env.
```bash
forge test -vv 

```

<div align="center">
  <p>Built with ❤️ by Saurabh</p>
  <p> 
    <a href="https://x.com/CaptainLEVI_XXX">X</a> 
  </p>
</div>
