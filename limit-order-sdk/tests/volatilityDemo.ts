import {JsonRpcProvider, Wallet, parseEther, parseUnits, formatEther, formatUnits} from 'ethers';
import {VolatilitySdk, Address, MakerTraits, VolatilitySpreadExt} from '@1inch/limit-order-sdk';

/**
 * VolatilitySdk Order Creation Demo
 * 
 * This demonstrates:
 * 1. Initializing the VolatilitySdk
 * 2. Creating orders with different volatility parameters
 * 3. Signing orders
 * 4. Previewing volatility effects
 * 5. Filling and cancelling orders
 */
async function volatilitySdkOrderDemo() {
  console.log('🚀 VolatilitySdk Order Creation Demo\n')

  // ============ SETUP ============
  const provider = new JsonRpcProvider(process.env.RPC_URL)
  const makerWallet = new Wallet(process.env.PRIVATE_KEY!, provider)
  const takerWallet = new Wallet(process.env.TAKER_PRIVATE_KEY || process.env.PRIVATE_KEY!, provider)

  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  
  console.log(`📋 Setup:`)
  console.log(`   Maker: ${makerWallet.address}`)
  console.log(`   Taker: ${takerWallet.address}`)
  console.log(`   Network: ${network.name}`)
  console.log(`   Chain ID: ${chainId}\n`)

  // ============ INITIALIZE SDK ============
  console.log('📊 Initializing VolatilitySdk')
  console.log('=' .repeat(40))

  const volatilitySdk = new VolatilitySdk({
    provider,
    volatilityContractAddress: process.env.VOLATILITY_CONTRACT_ADDRESS!
  })

  console.log(`✅ VolatilitySdk initialized`)
  console.log(`   Contract: ${process.env.VOLATILITY_CONTRACT_ADDRESS}\n`)

  // Token addresses
  const tokens = {
    WETH: new Address('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
    USDC: new Address('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')
  }

  // ============ SCENARIO 1: Conservative ETH/USDC Order ============
  console.log('📊 SCENARIO 1: Conservative ETH/USDC Order')
  console.log('=' .repeat(40))

  // Define conservative spread parameters with proper formatting
  const conservativeSpreadParams: VolatilitySpreadExt.SpreadParams = {
    baseSpreadBps: 25,       // 0.25% base spread
    volatilityMultiplier: 100, // 1x volatility multiplier
    maxSpreadBps: 150,       // 1.5% max spread
    volatilityWindow: 1      // 7-day volatility window
  }

  console.log(`\n🔹 Creating Conservative Order:`)
  console.log(`   Base Spread: ${conservativeSpreadParams.baseSpreadBps / 100}%`)
  console.log(`   Volatility Multiplier: ${conservativeSpreadParams.volatilityMultiplier / 100}x`)
  console.log(`   Max Spread: ${conservativeSpreadParams.maxSpreadBps / 100}%`)
  console.log(`   Window: ${conservativeSpreadParams.volatilityWindow === 0 ? '24h' : conservativeSpreadParams.volatilityWindow === 1 ? '7d' : 'blended'}`)

  try {
    // Create order using SDK
    const conservativeOrder = await volatilitySdk.createOrder(
      {
        maker: new Address(makerWallet.address),
        makerAsset: tokens.WETH,
        takerAsset: tokens.USDC,
        makingAmount: parseEther('1.0'),      // Selling 1 ETH
        takingAmount: parseUnits('3000', 6)   // For 3000 USDC
      },
      tokens.USDC,                            // Use USDC volatility
      conservativeSpreadParams,
      MakerTraits.default()
    )

    console.log(`\n✅ Order created successfully!`)
    console.log(`   Order Hash: ${conservativeOrder.getOrderHash(chainId)}`)
    console.log(`   Making Amount: ${formatEther(conservativeOrder.makingAmount)} WETH`)
    console.log(`   Taking Amount: ${formatUnits(conservativeOrder.takingAmount, 6)} USDC`)

    // Preview volatility effects
    try {
      const adjustedTaking = await conservativeOrder.getTakingAmount()
      const spreadEffect = adjustedTaking - conservativeOrder.takingAmount
      const spreadPercent = Number((spreadEffect * 10000n) / conservativeOrder.takingAmount) / 100

      console.log(`\n📊 Volatility Effects:`)
      console.log(`   Original Taking: ${formatUnits(conservativeOrder.takingAmount, 6)} USDC`)
      console.log(`   With Volatility: ${formatUnits(adjustedTaking, 6)} USDC`)
      console.log(`   Spread Effect: +${formatUnits(spreadEffect, 6)} USDC (${spreadPercent.toFixed(2)}%)`)

      const currentVolatility = await conservativeOrder.getCurrentVolatility()
      const currentSpread = await conservativeOrder.getVolatilitySpread()
      console.log(`   Current Volatility: ${formatUnits(currentVolatility.toString(), 2)}%`)
      console.log(`   Current Spread: ${formatUnits(currentSpread.toString(), 2)}%`)

    } catch (error: any) {
      console.log(`   📊 Volatility preview: ${error.message}`)
    }

    // Sign the order
    console.log(`\n🔐 Signing order...`)
    const orderTypedData = conservativeOrder.getTypedData(chainId)
    const signature = await makerWallet.signTypedData(
      orderTypedData.domain,
      orderTypedData.types,
      orderTypedData.message
    )
    console.log(`   ✅ Order signed: ${signature.slice(0, 20)}...`)

    // Store order reference for later use
    const order1 = { order: conservativeOrder, signature }

  } catch (error: any) {
    console.log(`   ❌ Failed to create order: ${error.message}`)
  }

  // ============ SCENARIO 2: Aggressive WETH/USDC Order ============
  console.log(`\n\n📊 SCENARIO 2: Aggressive WETH/USDC Order`)
  console.log('=' .repeat(40))

  // Define aggressive spread parameters
  const aggressiveSpreadParams: VolatilitySpreadExt.SpreadParams = {
    baseSpreadBps: 100,      // 1% base spread
    volatilityMultiplier: 500, // 5x volatility multiplier
    maxSpreadBps: 1000,      // 10% max spread
    volatilityWindow: 2      // Blended volatility window
  }

  console.log(`\n🔹 Creating Aggressive Order:`)
  console.log(`   Base Spread: ${aggressiveSpreadParams.baseSpreadBps / 100}%`)
  console.log(`   Volatility Multiplier: ${aggressiveSpreadParams.volatilityMultiplier / 100}x`)
  console.log(`   Max Spread: ${aggressiveSpreadParams.maxSpreadBps / 100}%`)
  console.log(`   Window: blended`)

  try {
    const aggressiveOrder = await volatilitySdk.createOrder(
      {
        maker: new Address(makerWallet.address),
        makerAsset: tokens.WETH,
        takerAsset: tokens.USDC,
        makingAmount: parseEther('0.1'),       // Selling 0.1 ETH
        takingAmount: parseUnits('300', 6)     // For 300 USDC
      },
      tokens.WETH,
      aggressiveSpreadParams,
      MakerTraits.default()
    )

    console.log(`\n✅ Aggressive order created!`)
    console.log(`   Order Hash: ${aggressiveOrder.getOrderHash(chainId)}`)
    console.log(`   Making: ${formatEther(aggressiveOrder.makingAmount)} WETH`)
    console.log(`   Taking: ${formatUnits(aggressiveOrder.takingAmount, 6)} USDC`)

    // Show order info
    console.log(`\n📋 Order Details:`)
    console.log(`   ${aggressiveOrder.getOrderInfo()}`)
    console.log(`   Target Token: ${aggressiveOrder.getTargetToken().toString().slice(0, 8)}...`)

    // Sign the order
    const aggressiveOrderTypedData = aggressiveOrder.getTypedData(chainId)
    const aggressiveSignature = await makerWallet.signTypedData(
      aggressiveOrderTypedData.domain,
      aggressiveOrderTypedData.types,
      aggressiveOrderTypedData.message
    )
    console.log(`   ✅ Aggressive order signed`)

    // Store for later use
    const order2 = { order: aggressiveOrder, signature: aggressiveSignature }

  } catch (error: any) {
    console.log(`   ❌ Failed to create aggressive order: ${error.message}`)
  }

  // ============ SCENARIO 3: Custom Parameters Order ============
  console.log(`\n\n📊 SCENARIO 3: Custom Parameters Order`)
  console.log('=' .repeat(40))

  // Custom spread parameters
  const customSpreadParams: VolatilitySpreadExt.SpreadParams = {
    baseSpreadBps: 75,       // 0.75% base
    volatilityMultiplier: 250, // 2.5x multiplier
    maxSpreadBps: 400,       // 4% max
    volatilityWindow: 0      // 24h window
  }

  console.log(`\n🔹 Creating Custom Order:`)
  console.log(`   Custom Parameters: ${customSpreadParams.baseSpreadBps / 100}% base, ${customSpreadParams.volatilityMultiplier / 100}x multiplier`)

  try {
    // Add custom maker traits
    const customMakerTraits = MakerTraits.default()
      .withExpiration(BigInt(Math.floor(Date.now() / 1000) + 24 * 60 * 60))

    const customOrder = await volatilitySdk.createOrder(
      {
        maker: new Address(makerWallet.address),
        makerAsset: tokens.WETH,
        takerAsset: tokens.USDC,
        makingAmount: parseEther('0.5'),       // Selling 0.5 ETH
        takingAmount: parseUnits('1500', 6)    // For 1500 USDC
      },
      tokens.WETH,                              // Use ETH volatility this time
      customSpreadParams,
      customMakerTraits
    )

    console.log(`\n✅ Custom order created with expiration!`)
    console.log(`   Order Hash: ${customOrder.getOrderHash(chainId)}`)

    // Check if volatility has changed significantly
    const hasChanged = await customOrder.hasVolatilityChanged(50) // 0.5% threshold
    console.log(`   Significant volatility change: ${hasChanged ? 'Yes' : 'No'}`)

  } catch (error: any) {
    console.log(`   ❌ Failed to create custom order: ${error.message}`)
  }

  // ============ SCENARIO 4: Order Operations ============
  console.log(`\n\n📊 SCENARIO 4: Order Operations`)
  console.log('=' .repeat(40))

  console.log(`\n🔄 Order Operations Available:`)
  console.log(`   1. Fill Order:`)
  console.log(`      await volatilitySdk.fillOrder(order, signature, takerWallet)`)
  
  console.log(`\n   2. Cancel Order:`)
  console.log(`      await volatilitySdk.cancelOrder(order, makerWallet)`)

  console.log(`\n   3. Preview Amounts:`)
  console.log(`      const adjustedAmount = await order.getTakingAmount()`)
  console.log(`      const currentSpread = await order.getVolatilitySpread()`)

  // ============ SCENARIO 5: Multiple Order Creation ============
  console.log(`\n\n📊 SCENARIO 5: Batch Order Creation`)
  console.log('=' .repeat(40))

  const orderConfigs = [
    { name: 'Small ETH', making: '0.1', taking: '300', spread: conservativeSpreadParams },
    { name: 'Medium ETH', making: '0.5', taking: '1500', spread: aggressiveSpreadParams },
    { name: 'Large ETH', making: '2.0', taking: '6000', spread: customSpreadParams }
  ]

  console.log(`\n🔹 Creating ${orderConfigs.length} orders in batch:`)

  const createdOrders = []
  for (const config of orderConfigs) {
    try {
      const order = await volatilitySdk.createOrder(
        {
          maker: new Address(makerWallet.address),
          makerAsset: tokens.WETH,
          takerAsset: tokens.USDC,
          makingAmount: parseEther(config.making),
          takingAmount: parseUnits(config.taking, 6)
        },
        tokens.USDC,
        config.spread
      )

      createdOrders.push(order)
      console.log(`   ✅ ${config.name}: ${order.getOrderHash(chainId).slice(0, 10)}...`)

    } catch (error: any) {
      console.log(`   ❌ ${config.name}: ${error.message}`)
    }
  }
}

// Error handling wrapper
async function runVolatilitySdkOrderDemo() {
  try {
    await volatilitySdkOrderDemo()
  } catch (error: any) {
    console.error(`❌ Demo failed:`, error)
    
    if (error.code === 'NETWORK_ERROR') {
      console.error(`💡 Hint: Check your RPC_URL and network connectivity`)
    } else if (error.message?.includes('VOLATILITY_CONTRACT_ADDRESS')) {
      console.error(`💡 Hint: Set VOLATILITY_CONTRACT_ADDRESS in your .env file`)
    } else if (error.message?.includes('revert')) {
      console.error(`💡 Hint: Contract may not be deployed or configured`)
    } else if (error.message?.includes('MakingAmountData')) {
      console.error(`💡 Hint: Check spread parameters format or contract configuration`)
    }
    
    process.exit(1)
  }
}

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Export for use as module
export { volatilitySdkOrderDemo, runVolatilitySdkOrderDemo }

// Run if called directly (ES module compatible)
const isMainModule = process.argv[1] && process.argv[1].includes('volatilityDemo');
if (isMainModule) {
  runVolatilitySdkOrderDemo()
}