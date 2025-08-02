// src/limit-order/limit-order-with-volatility.ts
import {UINT_40_MAX} from '@1inch/byte-utils'
import {VolatilitySpreadExtension} from './extensions/volatility-spread/volatility-spread.extension.js'
import {LimitOrder} from './limit-order.js'
import {LimitOrderV4Struct, OrderInfoData} from './types.js'
import {MakerTraits} from './maker-traits.js'
import {Extension} from './extensions/extension.js'
import {calcMakingAmount, calcTakingAmount} from './amounts.js'
import {Address} from '../address.js'
import {randBigInt} from '../utils/rand-bigint.js'

/**
 * @title LimitOrderWithVolatility
 * @notice dynamic Limit order based on volatility
 */
export class LimitOrderWithVolatility extends LimitOrder {
    constructor(
        orderInfo: OrderInfoData,
        makerTraits = MakerTraits.default(),
        public readonly volatilityExtension: VolatilitySpreadExtension
    ) {
        super(
            orderInfo,  
            makerTraits,
            volatilityExtension.build()
        )
    }

    /**
     * Set random nonce to `makerTraits` and creates `LimitOrderWithVolatility`
     */
    static withRandomNonce(
        orderInfo: OrderInfoData,
        volatilityExtension: VolatilitySpreadExtension,
        makerTraits = MakerTraits.default()
    ): LimitOrderWithVolatility {
        makerTraits.withNonce(randBigInt(UINT_40_MAX))

        return new LimitOrderWithVolatility(orderInfo, makerTraits, volatilityExtension)
    }

    /**
     * Create from existing order data and extension
     */
    static fromDataAndExtension(
        data: LimitOrderV4Struct,
        extension: Extension
    ): LimitOrderWithVolatility {
        const makerTraits = new MakerTraits(BigInt(data.makerTraits))
        const volatilityExt = VolatilitySpreadExtension.fromExtension(
            extension,
            new Address(data.receiver)
        )

        return new LimitOrderWithVolatility(
            {
                salt: BigInt(data.salt),
                maker: new Address(data.maker),
                makerAsset: new Address(data.makerAsset),
                takerAsset: new Address(data.takerAsset),
                makingAmount: BigInt(data.makingAmount),
                takingAmount: BigInt(data.takingAmount),
                receiver: new Address(data.receiver)
            },
            makerTraits,
            volatilityExt
        )
    }

    /**
     * Calculates the `takingAmount` required from the taker with volatility spread applied
     * 
     * @param makingAmount amount to be filled
     */
    public async getTakingAmountPreview(makingAmount = this.makingAmount): Promise<bigint> {

        const takingAmount = calcTakingAmount(
            makingAmount,
            this.makingAmount,
            this.takingAmount
        )

        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread(
                this.makerAsset,
                this.takerAsset
            )
            
            // Apply spread: takingAmount = original + (original * spread / 10000)
            const spreadAmount = (takingAmount * preview.dynamicSpread) / 10000n
            return takingAmount + spreadAmount
        } catch (error) {
            console.warn('Volatility preview failed, using base amount:', error)
            return takingAmount
        }
    }

    /**
     * Calculates the `makingAmount` that the taker receives with volatility spread applied
     * 
     * @param takingAmount amount to be filled
     */
    public async getMakingAmountPreview(takingAmount = this.takingAmount): Promise<bigint> {
        const makingAmount = calcMakingAmount(
            takingAmount,
            this.makingAmount,
            this.takingAmount
        )

        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread(
                this.makerAsset,
                this.takerAsset
            )
            
            // Apply spread: makingAmount = original - (original * spread / 10000)
            const spreadAmount = (makingAmount * preview.dynamicSpread) / 10000n
            return makingAmount - spreadAmount
        } catch (error) {
            console.warn('Volatility preview failed, using base amount:', error)
            return makingAmount
        }
    }

    /**
     * Get current volatility spread for this order
     * 
     * @returns Current dynamic spread in basis points
     */
    public async getVolatilitySpread(): Promise<bigint> {
        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread(
                this.makerAsset,
                this.takerAsset
            )
            return preview.dynamicSpread
        } catch (error) {
            console.warn('Failed to get volatility spread:', error)
            return BigInt(this.volatilityExtension.spreadParams.baseSpreadBps)
        }
    }

    /**
     * Get current volatility for the target token
     * 
     * @returns Current volatility value
     */
    public async getCurrentVolatility(): Promise<bigint> {
        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread(
                this.makerAsset,
                this.takerAsset
            )
            return preview.currentVolatility
        } catch (error) {
            console.warn('Failed to get current volatility:', error)
            return 0n
        }
    }

    /**
     * Get spread parameters used by this order
     * 
     * @returns Spread parameters
     */
    public getSpreadParams() {
        return this.volatilityExtension.spreadParams
    }

    /**
     * Get extension contract address
     * 
     * @returns Extension contract address
     */
    public getExtensionAddress(): Address {
        return this.volatilityExtension.address
    }
}