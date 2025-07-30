// src/limit-order/extensions/volatility-spread/volatility-spread.extension.ts
import {ethers, Contract, Provider, Wallet} from 'ethers'
import {trim0x} from '@1inch/byte-utils'
import assert from 'assert'
import {ExtensionBuilder} from '../extension-builder.js'
import {Extension} from '../extension.js'
import {Address} from '../../../address.js'

/**
 * @title VolatilitySpreadExtension
 * @notice Extension for volatility-based dynamic spreads following 1inch SDK patterns
 * 
 * This extension follows the same pattern as FeeTakerExtension and RangeAmountCalculator:
 * - Uses IAmountGetter interface on contract side
 * - Builds extension with contract address + encoded function call
 * - Handles order creation, signing, and filling
 */
export class VolatilitySpreadExtension {
  private constructor(
    public readonly contractAddress: Address,
    public readonly targetToken: Address,
    public readonly spreadParams: SpreadParams,
    public readonly contract?: Contract
  ) {}

  /**
   * Create new VolatilitySpreadExtension
   * 
   * @param contractAddress Address of deployed VolatilitySpreadCalculator
   * @param targetToken Token address to use for volatility calculation
   * @param spreadParams Volatility spread configuration
   * @param provider Optional provider for contract calls
   */
  static new(
    contractAddress: Address,
    targetToken: Address,
    spreadParams: SpreadParams,
    provider?: Provider
  ): VolatilitySpreadExtension {
    let contract: Contract | undefined

    if (provider) {
      contract = new Contract(
        contractAddress.toString(),
        VOLATILITY_CALCULATOR_ABI,
        provider
      )
    }

    return new VolatilitySpreadExtension(contractAddress, targetToken, spreadParams, contract)
  }

  /**
   * Build Extension object for use in orders
   * Follows RangeAmountCalculator pattern: contractAddress + encodedFunctionCall(withCutArgs)
   */
  build(): Extension {
    // Encode spread parameters for extraData
    const extraData = this.encodeSpreadParams()

    // Build making amount getter following RangeAmountCalculator pattern
    const makingAmountGetter = this.contractAddress.toString() + trim0x(this.cutLastArg(this.cutLastArg(
      this.encodeFunctionCall('getTakingAmount', extraData)
    )))

    // Build taking amount getter following RangeAmountCalculator pattern  
    const takingAmountGetter = this.contractAddress.toString() + trim0x(this.cutLastArg(this.cutLastArg(
      this.encodeFunctionCall('getMakingAmount', extraData)
    )))

    return new ExtensionBuilder()
      .withMakingAmountData(this.contractAddress, trim0x(this.cutLastArg(this.cutLastArg(
        this.encodeFunctionCall('getTakingAmount', extraData)
      ))))
      .withTakingAmountData(this.contractAddress, trim0x(this.cutLastArg(this.cutLastArg(
        this.encodeFunctionCall('getMakingAmount', extraData)
      ))))
      .build()
  }

  /**
   * Preview volatility and dynamic spread
   * Requires provider to be set during construction
   */
  async previewVolatilitySpread(): Promise<VolatilityPreview> {
    if (!this.contract) {
      throw new Error('Provider not available - pass provider during construction')
    }

    try {
      const result = await this.contract.previewSpread(
        this.targetToken.toString(),
        this.spreadParams.baseSpreadBps,
        this.spreadParams.volatilityMultiplier,
        this.spreadParams.maxSpreadBps,
        this.spreadParams.volatilityWindow
      )

      return {
        currentVolatility: result[0],
        dynamicSpread: result[1],
        targetToken: this.targetToken.toString(),
        spreadParams: this.spreadParams
      }
    } catch (error: any) {
      throw new Error(`Failed to preview volatility: ${error.message}`)
    }
  }

  /**
   * Calculate adjusted taking amount with volatility spread applied
   */
  async calculateAdjustedTakingAmount(originalTakingAmount: string): Promise<string> {
    const preview = await this.previewVolatilitySpread()
    const original = ethers.getBigInt(originalTakingAmount)
    const spreadBps = ethers.getBigInt(preview.dynamicSpread.toString())
    
    // Apply spread: takingAmount = original + (original * spread / 10000)
    const spreadAmount = (original * spreadBps) / 10000n
    return (original + spreadAmount).toString()
  }

  /**
   * Calculate adjusted making amount with volatility spread applied
   */
  async calculateAdjustedMakingAmount(originalMakingAmount: string): Promise<string> {
    const preview = await this.previewVolatilitySpread()
    const original = ethers.getBigInt(originalMakingAmount)
    const spreadBps = ethers.getBigInt(preview.dynamicSpread.toString())
    
    // Apply spread: makingAmount = original - (original * spread / 10000)
    const spreadAmount = (original * spreadBps) / 10000n
    return (original - spreadAmount).toString()
  }

  /**
   * Get human-readable extension information
   */
  getInfo(): string {
    return `VolatilitySpreadExtension(${this.contractAddress.toString().slice(0, 8)}...) ` +
           `Target: ${this.targetToken.toString().slice(0, 8)}... ` +
           `Base: ${this.spreadParams.baseSpreadBps / 100}% ` +
           `Multiplier: ${this.spreadParams.volatilityMultiplier / 100}x ` +
           `Max: ${this.spreadParams.maxSpreadBps / 100}%`
  }

  /**
   * Encode spread parameters for extraData (what goes to contract)
   */
  private encodeSpreadParams(): string {
    const abiCoder = ethers.AbiCoder.defaultAbiCoder()
    return abiCoder.encode(
      ['tuple(address,uint256,uint256,uint256,uint8)'],
      [[
        this.targetToken.toString(),
        this.spreadParams.baseSpreadBps,
        this.spreadParams.volatilityMultiplier,
        this.spreadParams.maxSpreadBps,
        this.spreadParams.volatilityWindow
      ]]
    )
  }

  /**
   * Encode function call for extension building
   * This mimics what RangeAmountCalculator does
   */
  private encodeFunctionCall(functionName: string, extraData: string): string {
    // Create dummy parameters that will be cut off
    const dummyOrder = {
      salt: '0',
      maker: ethers.ZeroAddress,
      receiver: ethers.ZeroAddress,
      makerAsset: ethers.ZeroAddress,
      takerAsset: ethers.ZeroAddress,
      makingAmount: '0',
      takingAmount: '0',
      makerTraits: '0'
    }

    const iface = new ethers.Interface(VOLATILITY_CALCULATOR_ABI)
    
    return iface.encodeFunctionData(functionName, [
      dummyOrder,           // order (will be cut)
      '0x',                 // extension (will be cut) 
      ethers.ZeroHash,      // orderHash
      ethers.ZeroAddress,   // taker
      '0',                  // amount
      '0',                  // remainingAmount (will be cut)
      extraData             // extraData (our spread params)
    ])
  }

  /**
   * Cut last argument from encoded function call (replaces cutLastArg from byte-utils)
   */
  private cutLastArg(data: string): string {
    if (!data.startsWith('0x')) {
      data = '0x' + data
    }
    
    // Remove the last 32 bytes (64 hex characters) which represents the last argument
    if (data.length < 66) { // 0x + at least 64 chars
      return data
    }
    
    return data.slice(0, -64)
  }

  /**
   * Decode extension from bytes (for validation/testing)
   */
  static fromExtension(extension: Extension, expectedContract: Address): VolatilitySpreadExtension {
    // Extract contract address from making amount data
    const contractAddress = Address.fromFirstBytes(extension.makingAmountData)
    
    assert(
      contractAddress.equal(expectedContract),
      'Extension contract address does not match expected address'
    )

    // This is a simplified decoder - in practice you'd extract the spread params
    // from the encoded function call data
    throw new Error('Extension decoding not implemented - use for creation only')
  }
}

// Spread parameters structure
export interface SpreadParams {
  baseSpreadBps: number        // Base spread (e.g., 50 = 0.5%)
  volatilityMultiplier: number // Volatility impact (e.g., 200 = 2x)
  maxSpreadBps: number        // Maximum spread (e.g., 300 = 3%)
  volatilityWindow: 0 | 1 | 2 // 0=24h, 1=7d, 2=blended
}

// Volatility preview result
export interface VolatilityPreview {
  currentVolatility: bigint
  dynamicSpread: bigint
  targetToken: string
  spreadParams: SpreadParams
}

// Helper for creating spread parameters
export class SpreadParamsBuilder {
  static conservative(): SpreadParams {
    return {
      baseSpreadBps: 25,      // 0.25%
      volatilityMultiplier: 100, // 1x
      maxSpreadBps: 150,      // 1.5%
      volatilityWindow: 1     // 7d
    }
  }

  static moderate(): SpreadParams {
    return {
      baseSpreadBps: 50,      // 0.5%
      volatilityMultiplier: 200, // 2x
      maxSpreadBps: 300,      // 3%
      volatilityWindow: 0     // 24h
    }
  }

  static aggressive(): SpreadParams {
    return {
      baseSpreadBps: 100,     // 1%
      volatilityMultiplier: 500, // 5x
      maxSpreadBps: 1000,     // 10%
      volatilityWindow: 2     // blended
    }
  }

  static custom(params: SpreadParams): SpreadParams {
    // Validate parameters
    if (params.baseSpreadBps < 0 || params.baseSpreadBps > 1000) {
      throw new Error('Base spread must be between 0 and 1000 bps')
    }
    if (params.maxSpreadBps < params.baseSpreadBps || params.maxSpreadBps > 1000) {
      throw new Error('Max spread must be >= base spread and <= 1000 bps')
    }
    if (params.volatilityMultiplier < 0 || params.volatilityMultiplier > 1000) {
      throw new Error('Volatility multiplier must be between 0 and 1000')
    }
    if (![0, 1, 2].includes(params.volatilityWindow)) {
      throw new Error('Volatility window must be 0, 1, or 2')
    }

    return params
  }
}

// Contract ABI for VolatilitySpreadCalculator
const VOLATILITY_CALCULATOR_ABI = [
  'function getTakingAmount(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes extension, bytes32 orderHash, address taker, uint256 makingAmount, uint256 remainingMakingAmount, bytes extraData) external view returns (uint256)',
  'function getMakingAmount(tuple(uint256 salt, address maker, address receiver, address makerAsset, address takerAsset, uint256 makingAmount, uint256 takingAmount, uint256 makerTraits) order, bytes extension, bytes32 orderHash, address taker, uint256 takingAmount, uint256 remainingMakingAmount, bytes extraData) external view returns (uint256)',
  'function previewSpread(address tokenA, uint256 baseSpreadBps, uint256 volatilityMultiplier, uint256 maxSpreadBps, uint8 volatilityWindow) external view returns (uint256 currentVolatility, uint256 dynamicSpread)',
  'function previewVolatility(address token, uint8 volatilityWindow) external view returns (uint256 currentVolatility)',
  'function validateSpreadParams(uint256 baseSpreadBps, uint256 volatilityMultiplier, uint256 maxSpreadBps, uint8 volatilityWindow) external pure'
]