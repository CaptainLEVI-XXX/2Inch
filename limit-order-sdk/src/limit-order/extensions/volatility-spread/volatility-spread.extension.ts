import {ethers, Contract, Provider} from 'ethers'
import {ExtensionBuilder} from '../extension-builder.js'
import {Extension} from '../extension.js'
import {Address} from '../../../address.js'
import {Interaction} from '../../interaction.js'
  
/**
 * @title VolatilitySpreadExtension
 * @notice Extension for volatility-based dynamic spreads
 */
export class VolatilitySpreadExtension {
    private constructor(
        public readonly address: Address,
        public readonly spreadParams: SpreadParams,
        public readonly contract?: Contract,
        public readonly makerPermit?: Interaction
    ) {}

    /**
     * Create new VolatilitySpreadExtension
     */
    static new(
        address: Address,
        spreadParams: SpreadParams,
        extra?: {
            makerPermit?: Interaction
            provider?: Provider
        }
    ): VolatilitySpreadExtension {
        let contract: Contract | undefined

        if (extra?.provider) {
            contract = new Contract(
                address.toString(),
                VOLATILITY_CALCULATOR_ABI,
                extra.provider
            )
        }

        return new VolatilitySpreadExtension(
            address,
            spreadParams,
            contract,
            extra?.makerPermit
        )
    }

    /**
     * Build Extension object for use in limit orders
     */
    build(): Extension {
        const amountGetterData = this.buildAmountGetterData()

        const builder = new ExtensionBuilder()
            .withMakingAmountData(this.address, amountGetterData)
            .withTakingAmountData(this.address, amountGetterData)

        if (this.makerPermit) {
            builder.withMakerPermit(
                this.makerPermit.target,
                this.makerPermit.data
            )
        }

        return builder.build()
    }

    /**
     * Build data for VolatilitySpreadCalculator amount getter
     * The data will be passed as the last parameter (extraData) to getTakingAmount/getMakingAmount
     * 
     * @private
     */
    private buildAmountGetterData(): string {
        // The contract expects properly ABI encoded SpreadParams struct
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        
        // Encode the SpreadParams struct
        const encodedParams = abiCoder.encode(
            ['uint256', 'uint256', 'uint256', 'uint8', 'bool'],
            [
                this.spreadParams.baseSpreadBps,
                this.spreadParams.volatilityMultiplier,
                this.spreadParams.maxSpreadBps,
                this.spreadParams.volatilityWindow,
                this.spreadParams.useTargetToken
            ]
        )
    
        return encodedParams
    }

    /**
     * Create from existing Extension (for deserialization)
     */
    static fromExtension(extension: Extension, expectedContract: Address): VolatilitySpreadExtension {
        const extensionAddress = Address.fromFirstBytes(extension.makingAmountData)
        
        if (!extensionAddress.equal(expectedContract)) {
            throw new Error('Extension contract address does not match expected address')
        }

        if (extension.takingAmountData !== extension.makingAmountData) {
            throw new Error('Invalid extension, taking amount data must equal making amount data')
        }

        // Extract encoded params from makingAmountData
        // Skip first 20 bytes (address)
        const encodedData = '0x' + extension.makingAmountData.slice(2 + 40)
        
        // Decode the spread params
        // Decode the spread params using ABI decoder
const abiCoder = ethers.AbiCoder.defaultAbiCoder()
const decoded = abiCoder.decode(
    ['uint256', 'uint256', 'uint256', 'uint8', 'bool'],
    encodedData
)

const spreadParams: SpreadParams = {
    baseSpreadBps: Number(decoded[0]),
    volatilityMultiplier: Number(decoded[1]),
    maxSpreadBps: Number(decoded[2]),
    volatilityWindow: Number(decoded[3]) as 0 | 1 | 2,
    useTargetToken: decoded[4]  // Now properly decoded as boolean
}

        const permit = extension.hasMakerPermit
            ? Interaction.decode(extension.makerPermit)
            : undefined

        return new VolatilitySpreadExtension(
            extensionAddress,
            spreadParams,
            undefined, // contract not available in deserialization
            permit
        )
    }

    async previewVolatilitySpread(makerAsset: Address, takerAsset: Address): Promise<VolatilityPreview> {

        if (!this.contract) {
            throw new Error('Provider not available - pass provider during construction')
        }
        const targetToken = this.spreadParams.useTargetToken ? makerAsset : takerAsset;
        const result = await this.contract.previewSpread.staticCall(
            targetToken.toString(),
            this.spreadParams.baseSpreadBps,
            this.spreadParams.volatilityMultiplier,
            this.spreadParams.maxSpreadBps,
            this.spreadParams.volatilityWindow
        );
    
        return {
            currentVolatility: BigInt(result[0].toString()),
            dynamicSpread: BigInt(result[1].toString()),
            targetToken: targetToken.toString(),
            spreadParams: this.spreadParams
        };
    }

    /**
     * Get human-readable extension information
     */
    getInfo(): string {
        const target = this.spreadParams.useTargetToken ? 'maker' : 'taker'
        return `VolatilitySpread(${this.address.toString().slice(0, 8)}...) ` +
               `Base: ${this.spreadParams.baseSpreadBps / 100}% ` +
               `Multiplier: ${this.spreadParams.volatilityMultiplier / 100}x ` +
               `Max: ${this.spreadParams.maxSpreadBps / 100}% ` +
               `Window: ${['24h', '7d', 'blended'][this.spreadParams.volatilityWindow]} ` +
               `Target: ${target} asset`
    }
}

// Spread parameters structure matching the contract
export interface SpreadParams {
    baseSpreadBps: number        // Base spread in basis points
    volatilityMultiplier: number // Volatility impact multiplier
    maxSpreadBps: number        // Maximum spread cap
    volatilityWindow: 0 | 1 | 2 // Time window
    useTargetToken: boolean     // true=use makerAsset, false=use takerAsset
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

    static custom(params: SpreadParams): SpreadParams {
        // Validate parameters
        if (params.baseSpreadBps < 0 || params.baseSpreadBps > 10000) {
            throw new Error('Base spread must be between 0 and 10000 bps')
        }
        if (params.maxSpreadBps < params.baseSpreadBps || params.maxSpreadBps > 10000) {
            throw new Error('Max spread must be >= base spread and <= 10000 bps')
        }
        if (params.volatilityMultiplier < 0 || params.volatilityMultiplier > 10000) {
            throw new Error('Volatility multiplier must be between 0 and 10000')
        }
        if (![0, 1, 2].includes(params.volatilityWindow)) {
            throw new Error('Volatility window must be 0, 1, or 2')
        }

        return params
    }
}
 const VOLATILITY_CALCULATOR_ABI = [ 
        {
        "inputs": [
            {
                "internalType": "address",
                "name": "tokenA",
                "type": "address"
            },
            {
                "internalType": "uint256",
                "name": "baseSpreadBps",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "volatilityMultiplier",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "maxSpreadBps",
                "type": "uint256"
            },
            {
                "internalType": "uint8",
                "name": "volatilityWindow",
                "type": "uint8"
            }
        ],
        "name": "previewSpread",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "currentVolatility",
                "type": "uint256"
            },
            {
                "internalType": "uint256",
                "name": "dynamicSpread",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
}]

