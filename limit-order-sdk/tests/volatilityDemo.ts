import {JsonRpcProvider, Wallet, parseEther, parseUnits, formatEther, formatUnits, Contract, ethers} from 'ethers';
import {VolatilitySdk, Address, MakerTraits, VolatilitySpreadExt, randBigInt, LimitOrderContract, TakerTraits, AmountMode} from '@1inch/limit-order-sdk';
import VolatilitySpreadCalculatorArtifact from '../../contracts/out/VolatilitySpreadCalculator.sol/VolatilitySpreadCalculator.json' with { type: 'json' };
import AggregationRouterV6ABI from '../src/abi/AggregationRouterV6.abi.json' with { type: 'json' };
import {getLimitOrderContract} from '@1inch/limit-order-sdk';

// npx ts-node -r dotenv/config tests/volatilityDemo.ts  
/**
 * VolatilitySdk Order Creation Demo
 * 
 * This demonstrates:
 * 1. Initializing the VolatilitySdk
 * 2. Creating orders with different volatility parameters
 * 3. Signing orders
 * 4. Previewing volatility effects
 * 5. Filling orders with volatility spreads
 */

// ============ SETUP ============
const provider = new JsonRpcProvider(process.env.RPC_URL!)
const makerWallet = new Wallet(process.env.PRIVATE_KEY!, provider)
const takerWallet = new Wallet(process.env.TAKER_PRIVATE_KEY!, provider)

// Contract artifacts
const VOLATILITY_CALCULATOR_ABI = VolatilitySpreadCalculatorArtifact.abi;
const VOLATILITY_CALCULATOR_BYTECODE = VolatilitySpreadCalculatorArtifact.bytecode.object || VolatilitySpreadCalculatorArtifact.bytecode;

// Global variable to store deployed contract address
let calculatorAddress: string = process.env.VOLATILITY_CONTRACT_ADDRESS || '';

// Token contract setup for approvals
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)"
];

async function deployVolatilityExtension() {
  console.log('🏗️  Deploying VolatilitySpreadCalculator')
  console.log('=' .repeat(40))

  try {
    // Check if contract is already deployed
    if (calculatorAddress && calculatorAddress !== '') {
      console.log(`   ✅ Using existing contract at: ${calculatorAddress}`)
      return {
        address: calculatorAddress,
        contract: new ethers.Contract(calculatorAddress, VOLATILITY_CALCULATOR_ABI, provider)
      }
    }

    // Deploy the contract
    const contractFactory = new ethers.ContractFactory(
      VOLATILITY_CALCULATOR_ABI,
      VOLATILITY_CALCULATOR_BYTECODE,
      makerWallet
    )

    const owner = makerWallet.address
    console.log(`   Deploying with owner: ${owner}`)

    // Estimate gas for deployment
    const deployTx = await contractFactory.getDeployTransaction(owner)
    const estimatedGas = await provider.estimateGas(deployTx)
    console.log(`   Estimated gas: ${estimatedGas}`)

    const calculator = await contractFactory.deploy(owner, {
      gasLimit: estimatedGas + 100000n // Add 100k gas buffer
    })
    
    console.log(`   Deployment transaction: ${calculator.deploymentTransaction()?.hash}`)
    
    await calculator.waitForDeployment()
    calculatorAddress = await calculator.getAddress()
    console.log(`   ✅ Contract deployed at: ${calculatorAddress}`)

    // Mainnet token addresses (same as Foundry script)
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'

    // Chainlink Price Feeds (same as Foundry script)
    const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
    const USDC_USD_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'

    // Setup token feeds
    console.log(`\n🔧 Setting up token feeds...`)
    
    const tokens = [WETH, USDC, DAI]
    const priceFeeds = [ETH_USD_FEED, USDC_USD_FEED, USDC_USD_FEED] // DAI uses USDC feed
    const isStablecoin = [false, true, true]
    const volatilityOverrides = [2000, 0, 0] // 20% volatility for WETH, default for stablecoins

    const setupTx = await calculator.addTokenFeeds(
      tokens,
      priceFeeds, 
      isStablecoin,
      volatilityOverrides,
      {
        gasLimit: 500000 // Explicit gas limit for setup
      }
    )
    
    console.log(`   Setup transaction: ${setupTx.hash}`)
    await setupTx.wait()

    console.log(`   ✅ Token feeds configured:`)
    console.log(`      WETH: ${WETH} (ETH/USD feed, 20% test volatility)`)
    console.log(`      USDC: ${USDC} (USDC/USD feed, stablecoin)`)
    console.log(`      DAI:  ${DAI} (USDC/USD feed, stablecoin)`)

    // Test the contract with a preview call
    console.log(`\n🧪 Testing contract functionality...`)
    
    try {
      const [currentVolatility, dynamicSpread] = await calculator.previewSpread(
        WETH,    // token
        25,      // baseSpreadBps (0.25%)
        100,     // volatilityMultiplier (1x)
        150,     // maxSpreadBps (1.5%)
        0        // volatilityWindow (24h)
      )

      console.log(`   Current Volatility: ${currentVolatility} (${Number(currentVolatility) / 100}%)`)
      console.log(`   Dynamic Spread: ${dynamicSpread} bps (${Number(dynamicSpread) / 100}%)`)
      console.log(`   ✅ Contract is working correctly!`)

    } catch (error: any) {
      console.log(`   ⚠️  Preview call failed: ${error.message}`)
      console.log(`   Contract deployed but may need additional setup`)
    }

    // Update environment variable for use in the rest of the demo
    process.env.VOLATILITY_CONTRACT_ADDRESS = calculatorAddress
    console.log(`\n📝 Updated VOLATILITY_CONTRACT_ADDRESS: ${calculatorAddress}`)

    return {
      contract: calculator,
      address: calculatorAddress,
      tokens: { WETH, USDC, DAI },
      priceFeeds: { ETH_USD_FEED, USDC_USD_FEED }
    }

  } catch (error: any) {
    console.error(`   ❌ Deployment failed: ${error.message}`)
    if (error.data) {
      console.error(`   Error data: ${error.data}`)
    }
    throw error
  }
}

async function ensureApprovals(
  tokenAddress: string,
  owner: Wallet,
  spender: string,
  amount: bigint
) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, owner);
  
  const currentAllowance = await token.allowance(owner.address, spender);
  console.log(`   Current allowance: ${currentAllowance}`);
  
  if (currentAllowance < amount) {
    console.log(`   Approving ${spender} to spend ${amount}...`);
    const approveTx = await token.approve(spender, amount);
    await approveTx.wait();
    console.log(`   ✅ Approval complete`);
  } else {
    console.log(`   ✅ Sufficient allowance already exists`);
  }
}

async function volatilitySdkOrderDemo() {
  console.log('🚀 VolatilitySdk Order Creation Demo\n')

  const expiresIn = 120n // 2m
  const expiration = BigInt(Math.floor(Date.now() / 1000)) + expiresIn
  const UINT_40_MAX = (1n << 40n) - 1n

  console.log("expiration", expiration)
  console.log("UINT_40_MAX", UINT_40_MAX)

  // see MakerTraits.ts
  const makerTraits = MakerTraits.default()
    .withExpiration(expiration)
    .withNonce(randBigInt(UINT_40_MAX))

  console.log("makerTraits", makerTraits)

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

  // Make sure we have a contract address
  if (!calculatorAddress || calculatorAddress === '') {
    throw new Error('Contract address not available. Deploy contract first.')
  }

  const volatilitySdk = new VolatilitySdk({
    provider,
    volatilityContractAddress: calculatorAddress
  })

  console.log(`✅ VolatilitySdk initialized`)
  console.log(`   Contract: ${calculatorAddress}\n`)

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
    baseSpreadBps: 50,              // 0.5% base
    volatilityMultiplier: 200,      // 2x multiplier
    maxSpreadBps: 200,              // 2% max
    volatilityWindow: 0,            // 24h
    useTargetToken: true            // Use maker asset (WETH)
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
      conservativeSpreadParams,
      makerTraits
    )

    console.log(`\n✅ Order created successfully!`)
    console.log(`   Order Hash: ${conservativeOrder.getOrderHash(chainId)}`)
    console.log(`   Making Amount: ${formatEther(conservativeOrder.makingAmount)} WETH`)
    console.log(`   Taking Amount: ${formatUnits(conservativeOrder.takingAmount, 6)} USDC`)

    // Preview volatility spread
    console.log(`\n📊 Previewing volatility effects...`)
    try {
      const volatilitySpread = await conservativeOrder.getVolatilitySpread()
      const takingAmountWithSpread = await conservativeOrder.getTakingAmountPreview()
      
      console.log(`   Current Spread: ${Number(volatilitySpread) / 100}%`)
      console.log(`   Taking Amount with Spread: ${formatUnits(takingAmountWithSpread, 6)} USDC`)
      console.log(`   Spread Impact: ${formatUnits(takingAmountWithSpread - conservativeOrder.takingAmount, 6)} USDC`)
    } catch (error: any) {
      console.log(`   Preview failed: ${error.message}`)
    }

    // Sign the order
    console.log(`\n🔐 Signing order...`)
    const orderTypedData = conservativeOrder.getTypedData(chainId)
    console.log('orderTypedData', JSON.stringify(orderTypedData, null, 2));
    
    const signature = await makerWallet.signTypedData(
      orderTypedData.domain,
      {Order: orderTypedData.types.Order},
      orderTypedData.message
    )
    console.log(`   ✅ Order signed: ${signature}`)

    // ============ FILL ORDER LOGIC ============
    console.log(`\n💱 Preparing to fill order...`)
    console.log('=' .repeat(40))

    // Get the limit order protocol contract address
    const limitOrderProtocolAddress = getLimitOrderContract(chainId);
    console.log(`   Limit Order Protocol: ${limitOrderProtocolAddress}`)

    // Ensure maker has approved the protocol to spend WETH
    console.log(`\n🔓 Checking maker approvals...`)
    await ensureApprovals(
      tokens.WETH.toString(),
      makerWallet,
      limitOrderProtocolAddress,
      conservativeOrder.makingAmount
    )

    // Ensure taker has approved the protocol to spend USDC
    console.log(`\n🔓 Checking taker approvals...`)
    const takingAmountWithSpread = await conservativeOrder.getTakingAmountPreview()
    await ensureApprovals(
      tokens.USDC.toString(),
      takerWallet,
      limitOrderProtocolAddress,
      takingAmountWithSpread + parseUnits('100', 6) // Add some buffer for spread
    )

    // Create taker traits
    const takerTraits = TakerTraits.default()
      .setAmountMode(AmountMode.maker) // We're specifying maker amount
      .setExtension(conservativeOrder.extension) // IMPORTANT: Must include the extension

    console.log(`\n📝 Fill Order Parameters:`)
    console.log(`   Amount Mode: Maker Amount`)
    console.log(`   Fill Amount: ${formatEther(conservativeOrder.makingAmount)} WETH`)
    console.log(`   Expected to pay: ~${formatUnits(takingAmountWithSpread, 6)} USDC`)

    // Generate fillOrderArgs calldata
    const fillOrderCalldata = LimitOrderContract.getFillOrderArgsCalldata(
      conservativeOrder.build(),
      signature,
      takerTraits,
      conservativeOrder.makingAmount // Fill the full amount
    )

    console.log(`\n🚀 Executing order fill...`)
    
    // Create contract instance
    const limitOrderProtocol = new ethers.Contract(
      limitOrderProtocolAddress,
      AggregationRouterV6ABI,
      takerWallet
    )

    // Check balances before fill
    const wethContract = new ethers.Contract(tokens.WETH.toString(), ERC20_ABI, provider)
    const usdcContract = new ethers.Contract(tokens.USDC.toString(), ERC20_ABI, provider)
    
    const makerWethBefore = await wethContract.balanceOf(makerWallet.address)
    const makerUsdcBefore = await usdcContract.balanceOf(makerWallet.address)
    const takerWethBefore = await wethContract.balanceOf(takerWallet.address)
    const takerUsdcBefore = await usdcContract.balanceOf(takerWallet.address)

    console.log(`\n💰 Balances before fill:`)
    console.log(`   Maker WETH: ${formatEther(makerWethBefore)}`)
    console.log(`   Maker USDC: ${formatUnits(makerUsdcBefore, 6)}`)
    console.log(`   Taker WETH: ${formatEther(takerWethBefore)}`)
    console.log(`   Taker USDC: ${formatUnits(takerUsdcBefore, 6)}`)

    try {
      // Execute the fill transaction
      const fillTx = await takerWallet.sendTransaction({
        to: limitOrderProtocolAddress,
        data: fillOrderCalldata,
        gasLimit: 500000 // Set appropriate gas limit
      })

      console.log(`   Transaction sent: ${fillTx.hash}`)
      console.log(`   Waiting for confirmation...`)
      
      const receipt = await fillTx.wait()
      console.log(`   ✅ Order filled successfully!`)
      console.log(`   Gas used: ${receipt?.gasUsed}`)

      // Check balances after fill
      const makerWethAfter = await wethContract.balanceOf(makerWallet.address)
      const makerUsdcAfter = await usdcContract.balanceOf(makerWallet.address)
      const takerWethAfter = await wethContract.balanceOf(takerWallet.address)
      const takerUsdcAfter = await usdcContract.balanceOf(takerWallet.address)

      console.log(`\n💰 Balances after fill:`)
      console.log(`   Maker WETH: ${formatEther(makerWethAfter)} (${formatEther(makerWethAfter - makerWethBefore)})`)
      console.log(`   Maker USDC: ${formatUnits(makerUsdcAfter, 6)} (+${formatUnits(makerUsdcAfter - makerUsdcBefore, 6)})`)
      console.log(`   Taker WETH: ${formatEther(takerWethAfter)} (+${formatEther(takerWethAfter - takerWethBefore)})`)
      console.log(`   Taker USDC: ${formatUnits(takerUsdcAfter, 6)} (${formatUnits(takerUsdcAfter - takerUsdcBefore, 6)})`)

      // Calculate actual spread paid
      const actualUsdcPaid = takerUsdcBefore - takerUsdcAfter
      const baseAmount = conservativeOrder.takingAmount
      const spreadPaid = BigInt(actualUsdcPaid) - baseAmount
      const spreadBps = (spreadPaid * 10000n) / baseAmount

      console.log(`\n📊 Fill Analysis:`)
      console.log(`   Base USDC Amount: ${formatUnits(baseAmount, 6)}`)
      console.log(`   Actual USDC Paid: ${formatUnits(actualUsdcPaid, 6)}`)
      console.log(`   Spread Paid: ${formatUnits(spreadPaid, 6)} USDC`)
      console.log(`   Spread in bps: ${Number(spreadBps) / 100}%`)

    } catch (error: any) {
      console.error(`   ❌ Fill failed: ${error.message}`)
      if (error.data) {
        console.error(`   Error data:`, error.data)
      }
      
      // Try to decode the error
      try {
        const errorInterface = new ethers.Interface(AggregationRouterV6ABI)
        const decodedError = errorInterface.parseError(error.data)
        console.error(`   Decoded error:`, decodedError)
      } catch (e) {
        // Ignore decoding errors
      }
    }

    console.log(`\n📊 Order Demo Complete!`)
    return { order: conservativeOrder, signature }

  } catch (error: any) {
    console.error(`   ❌ Failed to create order: ${error.message}`)
    throw error
  }
}

// Error handling wrapper
async function runVolatilitySdkOrderDemo() {
  try {
    console.log('🎯 Starting Volatility SDK Demo\n')
    
    // Deploy contract first
    await deployVolatilityExtension()
    
    // Then run the demo
    await volatilitySdkOrderDemo()
    
    console.log('\n🎉 Demo completed successfully!')
    
  } catch (error: any) {
    console.error('\n💥 Demo failed:', error.message)
    if (error.stack) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

// Export for use as module
export { volatilitySdkOrderDemo, runVolatilitySdkOrderDemo, deployVolatilityExtension }

// Run if called directly (ES module compatible)
const isMainModule = process.argv[1] && process.argv[1].includes('volatilityDemo');
if (isMainModule) {
  runVolatilitySdkOrderDemo()
}