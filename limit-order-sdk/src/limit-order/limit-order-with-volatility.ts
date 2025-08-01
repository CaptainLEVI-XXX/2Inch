// src/limit-order/limit-order-with-volatility.ts
import {UINT_40_MAX} from '@1inch/byte-utils'
import assert from 'assert'
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
 * @notice Limit order with volatility-based dynamic spreads
 * 
 * This follows the exact same pattern as LimitOrderWithFee
 */
export class LimitOrderWithVolatility extends LimitOrder {
    constructor(
        /**
         * Use `VolatilitySpreadExtension.customReceiver` to set custom receiver if needed
         */
        orderInfo: Omit<OrderInfoData, 'receiver'>,
        makerTraits = MakerTraits.default(),
        public readonly volatilityExtension: VolatilitySpreadExtension
    ) {
        // Following LimitOrderWithFee pattern - no need to manually enable extension
        // The parent constructor will handle it based on extension.isEmpty()
        
        super(
            {...orderInfo, receiver: volatilityExtension.address},
            makerTraits,
            volatilityExtension.build()
        )
    }

    /**
     * Set random nonce to `makerTraits` and creates `LimitOrderWithVolatility`
     * Following LimitOrderWithFee.withRandomNonce() pattern
     */
    static withRandomNonce(
        orderInfo: Omit<OrderInfoData, 'receiver'>,
        volatilityExtension: VolatilitySpreadExtension,
        makerTraits = MakerTraits.default()
    ): LimitOrderWithVolatility {
        makerTraits.withNonce(randBigInt(UINT_40_MAX))

        return new LimitOrderWithVolatility(orderInfo, makerTraits, volatilityExtension)
    }

    /**
     * Create from existing order data and extension
     * Following LimitOrderWithFee.fromDataAndExtension() pattern
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

        assert(
            volatilityExt.address.equal(new Address(data.receiver)),
            `invalid order: receiver must be VolatilitySpreadCalculator extension address`
        )

        return new LimitOrderWithVolatility(
            {
                salt: BigInt(data.salt),
                maker: new Address(data.maker),
                makerAsset: new Address(data.makerAsset),
                takerAsset: new Address(data.takerAsset),
                makingAmount: BigInt(data.makingAmount),
                takingAmount: BigInt(data.takingAmount)
            },
            makerTraits,
            volatilityExt
        )
    }

    /**
     * Calculates the `takingAmount` required from the taker with volatility spread applied
     * Note: This is a preview method - actual calculation happens on-chain
     * 
     * @param makingAmount amount to be filled
     */
    public async getTakingAmountPreview(makingAmount = this.makingAmount): Promise<bigint> {

        console.log('Getting taking amount preview...')
        const takingAmount = calcTakingAmount(
            makingAmount,
            this.makingAmount,
            this.takingAmount
        )

        console.log('Taking amount preview:', takingAmount)

        // try {
            const preview = await this.volatilityExtension.previewVolatilitySpread(
                this.makerAsset,
                this.takerAsset
            )
            
            // Apply spread: takingAmount = original + (original * spread / 10000)
            const spreadAmount = (takingAmount * preview.dynamicSpread) / 10000n
            return takingAmount + spreadAmount
        // } catch (error) {
        //     console.warn('Volatility preview failed, using base amount:', error)
        //     return takingAmount
        // }
    }

    /**
     * Calculates the `makingAmount` that the taker receives with volatility spread applied
     * Note: This is a preview method - actual calculation happens on-chain
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