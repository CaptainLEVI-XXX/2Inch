// SPDX-License-Identifier: MIT
import {
  JsonRpcProvider,
  Wallet,
  parseEther,
  parseUnits,
  formatEther,
  formatUnits,
  Contract,
  ethers
} from 'ethers';
import {
  VolatilitySdk,
  Address,
  MakerTraits,
  VolatilitySpreadExt,
  randBigInt,
  LimitOrderContract,
  TakerTraits,
  AmountMode
} from '@1inch/limit-order-sdk';
import VolatilitySpreadCalculatorArtifact from '../../contracts/out/VolatilitySpreadCalculator.sol/VolatilitySpreadCalculator.json' with { type: 'json' };
import { getLimitOrderContract } from '@1inch/limit-order-sdk';
import { WETH, USDC, DAI, ETH_USD_FEED, USDC_USD_FEED } from './addresses.ts';

const provider = new JsonRpcProvider(process.env.RPC_URL!);
const makerWallet = new Wallet(process.env.PRIVATE_KEY!, provider);
const takerWallet = new Wallet(process.env.TAKER_PRIVATE_KEY!, provider);

const VOLATILITY_CALCULATOR_ABI = VolatilitySpreadCalculatorArtifact.abi;
const VOLATILITY_CALCULATOR_BYTECODE = VolatilitySpreadCalculatorArtifact.bytecode.object || VolatilitySpreadCalculatorArtifact.bytecode;

let calculatorAddress: string = process.env.VOLATILITY_CONTRACT_ADDRESS || '';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)'
];

function requireEnv(varName: string): string {
  const val = process.env[varName];
  if (!val) throw new Error(`Missing required env var: ${varName}`);
  return val;
}

async function ensureBatchApprovals(
  wallet: Wallet,
  tokens: string[],
  spender: string,
  amounts: bigint[]
) {
  for (let i = 0; i < tokens.length; i++) {
    const token = new Contract(tokens[i], ERC20_ABI, wallet);
    const current = await token.allowance(wallet.address, spender);
    if (current < amounts[i]) {
      console.log(`→ Approving ${spender} for ${formatUnits(amounts[i], 18)} on ${tokens[i]}`);
      await (await token.approve(spender, amounts[i])).wait();
    } else {
      console.log(`✔ Already approved for ${tokens[i]}`);
    }
  }
}

const SpreadProfiles = {
  conservative: {
    baseSpreadBps: 50,
    volatilityMultiplier: 200,
    maxSpreadBps: 200,
    volatilityWindow: 0,
    useTargetToken: true
  },
  aggressive: {
    baseSpreadBps: 25,
    volatilityMultiplier: 300,
    maxSpreadBps: 500,
    volatilityWindow: 1,
    useTargetToken: false
  }
};

const ONE_ETH = parseEther('1');
const THREE_K_USDC = parseUnits('3000', 6);

async function deployVolatilityExtension() {
  if (calculatorAddress && calculatorAddress !== '') {
    console.log(`✅ Using existing contract at: ${calculatorAddress}`);
    return new Contract(calculatorAddress, VOLATILITY_CALCULATOR_ABI, provider);
  }

  const factory = new ethers.ContractFactory(
    VOLATILITY_CALCULATOR_ABI,
    VOLATILITY_CALCULATOR_BYTECODE,
    makerWallet
  );
  const contract = await factory.deploy(makerWallet.address);
  await contract.waitForDeployment();
  calculatorAddress = await contract.getAddress();
  console.log(`✅ Deployed VolatilitySpreadCalculator at ${calculatorAddress}`);

  await contract.addTokenFeeds(
    [WETH, USDC, DAI],
    [ETH_USD_FEED, USDC_USD_FEED, USDC_USD_FEED],
    [false, true, true],
    [2000, 0, 0]
  );

  return contract;
}

function printOrderDetails(order: VolatilitySdk.Order, chainId: number) {
  console.log(`Hash: ${order.getOrderHash(chainId)}`);
  console.log(`Making: ${formatEther(order.makingAmount)} ${order.makerAsset}`);
  console.log(`Taking: ${formatUnits(order.takingAmount, 6)} ${order.takerAsset}`);
}

async function runVolatilitySdkOrderDemo() {
  const chainId = Number((await provider.getNetwork()).chainId);
  const calculator = await deployVolatilityExtension();
  const volatilitySdk = new VolatilitySdk({ provider, volatilityContractAddress: calculatorAddress });

  const makerTraits = MakerTraits.default()
    .withExpiration(BigInt(Math.floor(Date.now() / 1000)) + 120n)
    .withNonce(randBigInt((1n << 40n) - 1n));

  const order = await volatilitySdk.createOrder(
    {
      maker: new Address(makerWallet.address),
      makerAsset: new Address(WETH),
      takerAsset: new Address(USDC),
      makingAmount: ONE_ETH,
      takingAmount: THREE_K_USDC
    },
    SpreadProfiles.conservative,
    makerTraits
  );

  printOrderDetails(order, chainId);

  const limitOrderProtocolAddress = getLimitOrderContract(chainId);
  const takingAmountWithSpread = await order.getTakingAmountPreview();

  await ensureBatchApprovals(
    makerWallet,
    [WETH],
    limitOrderProtocolAddress,
    [ONE_ETH]
  );

  await ensureBatchApprovals(
    takerWallet,
    [USDC],
    limitOrderProtocolAddress,
    [takingAmountWithSpread + parseUnits('100', 6)]
  );

  const signature = await makerWallet.signTypedData(
    order.getTypedData(chainId).domain,
    { Order: order.getTypedData(chainId).types.Order },
    order.getTypedData(chainId).message
  );

  const takerTraits = TakerTraits.default()
    .setAmountMode(AmountMode.maker)
    .setExtension(order.extension);

  const calldata = LimitOrderContract.getFillOrderArgsCalldata(
    order.build(),
    signature,
    takerTraits,
    ONE_ETH
  );

  const wethContract = new ethers.Contract(WETH, ERC20_ABI, provider);
  const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider);

  const makerWethBefore = await wethContract.balanceOf(makerWallet.address);
  const makerUsdcBefore = await usdcContract.balanceOf(makerWallet.address);
  const takerWethBefore = await wethContract.balanceOf(takerWallet.address);
  const takerUsdcBefore = await usdcContract.balanceOf(takerWallet.address);

  const tx = await takerWallet.sendTransaction({
    to: limitOrderProtocolAddress,
    data: calldata,
    gasLimit: 500_000
  });


  const makerWethAfter = await wethContract.balanceOf(makerWallet.address);
  const makerUsdcAfter = await usdcContract.balanceOf(makerWallet.address);
  const takerWethAfter = await wethContract.balanceOf(takerWallet.address);
  const takerUsdcAfter = await usdcContract.balanceOf(takerWallet.address);


  console.log(`Maker WETH Before: ${formatEther(makerWethBefore)}`);
  console.log(`Maker WETH After: ${formatEther(makerWethAfter)}`);

  console.log(`Maker USDC Before: ${formatUnits(makerUsdcBefore, 6)}`);
  console.log(`Maker USDC After: ${formatUnits(makerUsdcAfter, 6)}`);

  console.log(`Taker WETH Before: ${formatEther(takerWethBefore)}`);
  console.log(`Taker WETH After: ${formatEther(takerWethAfter)}`);

  console.log(`Taker USDC Before: ${formatUnits(takerUsdcBefore, 6)}`);
  console.log(`Taker USDC After: ${formatUnits(takerUsdcAfter, 6)}`);


  console.log(`✅ Order fill tx: ${tx.hash}`);
  await tx.wait();
  console.log('🎉 Order filled successfully!');
}

// Run the demo if directly executed
if (process.argv[1].includes('volatilityDemo')) {
  runVolatilitySdkOrderDemo().catch(console.error);
}

export { runVolatilitySdkOrderDemo, deployVolatilityExtension };
