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
 * This class follows the same pattern as LimitOrderWithFee but applies
 * volatility-based dynamic spreads instead of fixed fees. It extends
 * the base LimitOrder class and integrates with VolatilitySpreadExtension.
 */
export class LimitOrderWithVolatility extends LimitOrder {
    constructor(
        /**
         * Order information without receiver (receiver will be set to volatility contract)
         */
        orderInfo: Omit<OrderInfoData, 'receiver'>,
        makerTraits = MakerTraits.default(),
        public readonly volatilityExtension: VolatilitySpreadExtension
    ) {
        // Enable the extension flags needed for volatility calculation
        makerTraits.enableExtension() // Enable extension processing
        
        super(
            {...orderInfo, receiver: volatilityExtension.contractAddress},
            makerTraits,
            volatilityExtension.build()
        )
    }

    /**
     * Create LimitOrderWithVolatility with random nonce
     * 
     * @param orderInfo Order information
     * @param volatilityExtension Volatility spread extension
     * @param makerTraits Optional maker traits
     * @returns New LimitOrderWithVolatility instance
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
     * Create LimitOrderWithVolatility from existing order data and extension
     * 
     * @param data Order struct data
     * @param extension Extension data
     * @returns LimitOrderWithVolatility instance
     */
    static fromDataAndExtension(
        data: LimitOrderV4Struct,
        extension: Extension
    ): LimitOrderWithVolatility {
        const makerTraits = new MakerTraits(BigInt(data.makerTraits))
        
        // Extract volatility extension from the extension data
        const volatilityExt = VolatilitySpreadExtension.fromExtension(
            extension, 
            new Address(data.receiver) // Expected contract address
        )

        assert(
            volatilityExt.contractAddress.equal(new Address(data.receiver)),
            `invalid order: receiver must be VolatilitySpreadCalculator address`
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
     * 
     * @param makingAmount Amount to be filled
     * @returns Taking amount with dynamic volatility spread
     */
    public async getTakingAmount(makingAmount = this.makingAmount): Promise<bigint> {
        // Calculate base taking amount proportionally
        const baseTakingAmount = calcTakingAmount(
            makingAmount,
            this.makingAmount,
            this.takingAmount
        )

        // Apply volatility spread adjustment
        try {
            const adjustedAmount = await this.volatilityExtension.calculateAdjustedTakingAmount(
                baseTakingAmount.toString()
            )
            return BigInt(adjustedAmount)
        } catch (error) {
            // Fallback to base amount if volatility calculation fails
            console.warn('Volatility calculation failed, using base amount:', error)
            return baseTakingAmount
        }
    }

    /**
     * Calculates the `makingAmount` that the taker receives with volatility spread applied
     * 
     * @param takingAmount Amount to be filled
     * @returns Making amount with dynamic volatility spread
     */
    public async getMakingAmount(takingAmount = this.takingAmount): Promise<bigint> {
        // Calculate base making amount proportionally
        const baseMakingAmount = calcMakingAmount(
            takingAmount,
            this.makingAmount,
            this.takingAmount
        )

        // Apply volatility spread adjustment
        try {
            const adjustedAmount = await this.volatilityExtension.calculateAdjustedMakingAmount(
                baseMakingAmount.toString()
            )
            return BigInt(adjustedAmount)
        } catch (error) {
            // Fallback to base amount if volatility calculation fails
            console.warn('Volatility calculation failed, using base amount:', error)
            return baseMakingAmount
        }
    }

    /**
     * Get current volatility spread for this order
     * 
     * @returns Current dynamic spread in basis points
     */
    public async getVolatilitySpread(): Promise<bigint> {
        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread()
            return preview.dynamicSpread
        } catch (error) {
            console.warn('Failed to get volatility spread:', error)
            return BigInt(this.volatilityExtension.spreadParams.baseSpreadBps)
        }
    }

    /**
     * Get current volatility for the target token
     * 
     * @returns Current volatility in basis points
     */
    public async getCurrentVolatility(): Promise<bigint> {
        try {
            const preview = await this.volatilityExtension.previewVolatilitySpread()
            return preview.currentVolatility
        } catch (error) {
            console.warn('Failed to get current volatility:', error)
            return 0n
        }
    }

    /**
     * Calculate the spread effect on a given amount
     * 
     * @param baseAmount Base amount before spread
     * @param isForTaking Whether this is for taking amount (true) or making amount (false)
     * @returns Spread effect amount
     */
    public async getSpreadEffect(baseAmount: bigint, isForTaking: boolean = true): Promise<bigint> {
        try {
            const spread = await this.getVolatilitySpread()
            const spreadAmount = (baseAmount * spread) / 10000n
            
            // For taking amount, spread is added (taker pays more)
            // For making amount, spread is subtracted (maker gives less)
            return isForTaking ? spreadAmount : -spreadAmount
        } catch (error) {
            console.warn('Failed to calculate spread effect:', error)
            return 0n
        }
    }

    /**
     * Get human-readable order information including volatility details
     * 
     * @returns Order information string
     */
    public getOrderInfo(): string {
        const makerAssetStr = this.makerAsset.toString()
        const takerAssetStr = this.takerAsset.toString()
        const makingAmountStr = this.makingAmount.toString()
        const takingAmountStr = this.takingAmount.toString()
        
        return `VolatilityOrder(${makerAssetStr.slice(0, 8)}.../${takerAssetStr.slice(0, 8)}...) ` +
               `Making: ${makingAmountStr} Taking: ${takingAmountStr} ` +
               `${this.volatilityExtension.getInfo()}`
    }

    /**
     * Check if this order has significant volatility changes since creation
     * 
     * @param thresholdBps Threshold in basis points for significant change
     * @returns Whether volatility has changed significantly
     */
    public async hasVolatilityChanged(thresholdBps: number = 50): Promise<boolean> {
        try {
            const currentSpread = await this.getVolatilitySpread()
            const baseSpread = BigInt(this.volatilityExtension.spreadParams.baseSpreadBps)
            const change = currentSpread > baseSpread ? 
                currentSpread - baseSpread : 
                baseSpread - currentSpread
            
            return change >= BigInt(thresholdBps)
        } catch (error) {
            console.warn('Failed to check volatility change:', error)
            return false
        }
    }

    /**
     * Get volatility extension parameters
     * 
     * @returns Spread parameters used by this order
     */
    public getSpreadParams() {
        return this.volatilityExtension.spreadParams
    }

    /**
     * Get target token used for volatility calculation
     * 
     * @returns Target token address
     */
    public getTargetToken(): Address {
        return this.volatilityExtension.targetToken
    }

    /**
     * Preview what amounts would be with current volatility
     * 
     * @param amount Amount to preview
     * @param type Whether to preview making or taking amount
     * @returns Previewed amount with current volatility
     */
    public async previewAmount(
        amount: bigint = this.makingAmount, 
        type: 'making' | 'taking' = 'making'
    ): Promise<bigint> {
        if (type === 'making') {
            return this.getMakingAmount(amount)
        } else {
            return this.getTakingAmount(amount)
        }
    }
}