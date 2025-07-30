// src/sdk/volatility-sdk.ts
import {Provider} from 'ethers'
import {Address} from '../address.js'
import {
    LimitOrderWithVolatility,
    MakerTraits,
    OrderInfoData,
    VolatilitySpreadExt
} from '../limit-order/index.js'

export interface VolatilityConfig {
    provider: Provider
    volatilityContractAddress: string
}

export class VolatilitySdk {
    private readonly provider: Provider
    private readonly volatilityContractAddress: string

    constructor(config: VolatilityConfig) {
        this.provider = config.provider
        this.volatilityContractAddress = config.volatilityContractAddress
    }

    /**
     * Create LimitOrder with volatility extension params
     *
     * @returns LimitOrderWithVolatility to sign and handle locally
     */
    public async createOrder(
        orderInfo: OrderInfoData,
        targetToken: Address,
        spreadParams: VolatilitySpreadExt.SpreadParams,
        makerTraits = MakerTraits.default()
    ): Promise<LimitOrderWithVolatility> {

        console.log("targetToken: ",  targetToken)
        
        const volatilityExt = VolatilitySpreadExt.VolatilitySpreadExtension.new(
            new Address(this.volatilityContractAddress),
            targetToken,
            spreadParams,
            this.provider
        )
        console.log("volatilityExt: ", volatilityExt)

        return new LimitOrderWithVolatility(orderInfo, makerTraits, volatilityExt)
    }
}