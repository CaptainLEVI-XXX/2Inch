// src/sdk/volatility-sdk.ts
import {Provider} from 'ethers'
import {Address} from '../address.js'
import {
    LimitOrderWithVolatility,
    MakerTraits,
    OrderInfoData,
    VolatilitySpreadExt,
    Interaction
} from '../limit-order/index.js'

export interface VolatilityConfig {
    provider: Provider
    volatilityContractAddress: string
}

/**
 * SDK for creating limit orders with volatility-based dynamic spreads
 */
export class VolatilitySdk {
    private readonly provider: Provider
    private readonly volatilityContractAddress: Address

    constructor(config: VolatilityConfig) {
        this.provider = config.provider
        this.volatilityContractAddress = new Address(config.volatilityContractAddress)
    }

    /**
     * Create LimitOrder with volatility extension
     * Following the pattern of Sdk.createOrder()
     * 
     * @param orderInfo Order information
     * @param spreadParams Volatility spread parameters
     * @param makerTraits Optional maker traits
     * @param extra Optional extras like makerPermit
     * @returns LimitOrderWithVolatility ready to sign
     */
    public async createOrder(
        orderInfo: OrderInfoData,
        spreadParams: VolatilitySpreadExt.SpreadParams,
        makerTraits = MakerTraits.default(),
        extra: {
            makerPermit?: Interaction
        } = {}
    ): Promise<LimitOrderWithVolatility> {
        
        // Create the volatility extension
        const volatilityExt = VolatilitySpreadExt.VolatilitySpreadExtension.new(
            this.volatilityContractAddress,
            spreadParams,
            {
                makerPermit: extra.makerPermit,
                provider: this.provider
            }
        )

        // Create the order with volatility extension
        return new LimitOrderWithVolatility(orderInfo, makerTraits, volatilityExt)
    }

    /**
     * Preview current volatility and spread for a token pair
     * 
     * @param makerAsset Maker asset address
     * @param takerAsset Taker asset address
     * @param spreadParams Spread parameters to use
     * @returns Preview of current volatility and calculated spread
     */
    public async previewVolatility(
        makerAsset: Address,
        takerAsset: Address,
        spreadParams: VolatilitySpreadExt.SpreadParams
    ): Promise<VolatilitySpreadExt.VolatilityPreview> {
        // Create temporary extension just for preview
        const tempExt = VolatilitySpreadExt.VolatilitySpreadExtension.new(
            this.volatilityContractAddress,
            spreadParams,
            {
                provider: this.provider
            }
        )

        return tempExt.previewVolatilitySpread(makerAsset, takerAsset)
    }

    /**
     * Get the volatility contract address
     * 
     * @returns Volatility calculator contract address
     */
    public getVolatilityContractAddress(): Address {
        return this.volatilityContractAddress
    }

    /**
     * Create order with random nonce
     * @param orderInfo Order information
     * @param spreadParams Volatility spread parameters
     * @param extra Optional extras
     * @returns LimitOrderWithVolatility with random nonce
     */
    public async createOrderWithRandomNonce(
        orderInfo: OrderInfoData,
        spreadParams: VolatilitySpreadExt.SpreadParams,
        extra: {
            makerPermit?: Interaction
        } = {}
    ): Promise<LimitOrderWithVolatility> {
        
        const volatilityExt = VolatilitySpreadExt.VolatilitySpreadExtension.new(
            this.volatilityContractAddress,
            spreadParams,
            {
                makerPermit: extra.makerPermit,
                provider: this.provider
            }
        )

        return LimitOrderWithVolatility.withRandomNonce(
            orderInfo,
            volatilityExt,
            MakerTraits.default()
        )
    }
}