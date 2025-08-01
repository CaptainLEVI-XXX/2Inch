// src/limit-order/extensions/volatility-spread/volatility-spread.extension.ts
import {ethers, Contract, Provider} from 'ethers'
import {BytesBuilder} from '@1inch/byte-utils'
import {ExtensionBuilder} from '../extension-builder.js'
import {Extension} from '../extension.js'
import {Address} from '../../../address.js'
import {Interaction} from '../../interaction.js'

/**
 * @title VolatilitySpreadExtension
 * @notice Extension for volatility-based dynamic spreads following FeeTakerExtension pattern
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
     * Following the pattern from FeeTakerExtension.new()
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
     * Following the exact pattern from FeeTakerExtension.build()
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
     * This follows the same pattern as FeeTakerExtension.buildAmountGetterData()
     * 
     * The data will be passed as the last parameter (extraData) to getTakingAmount/getMakingAmount
     * 
     * @private
     */
    private buildAmountGetterData(): string {
        // Build the data that will be passed to the contract as extraData
        const builder = new BytesBuilder()
            .addUint256(BigInt(this.spreadParams.baseSpreadBps))
            .addUint256(BigInt(this.spreadParams.volatilityMultiplier))
            .addUint256(BigInt(this.spreadParams.maxSpreadBps))
            .addUint8(BigInt(this.spreadParams.volatilityWindow))
            .addUint8(this.spreadParams.useTargetToken ? 1n : 0n)

        return builder.asHex()
    }

    /**
     * Create from existing Extension (for deserialization)
     * Following FeeTakerExtension.fromExtension() pattern
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
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        const decoded = abiCoder.decode(
            ['uint256', 'uint256', 'uint256', 'uint8', 'uint8'],
            encodedData
        )

        const spreadParams: SpreadParams = {
            baseSpreadBps: Number(decoded[0]),
            volatilityMultiplier: Number(decoded[1]),
            maxSpreadBps: Number(decoded[2]),
            volatilityWindow: Number(decoded[3]) as 0 | 1 | 2,
            useTargetToken: decoded[4] === 1n
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

    // /**
    //  * Preview volatility and dynamic spread
    //  * Requires provider to be set during construction
    //  */
    // async previewVolatilitySpread(makerAsset: Address, takerAsset: Address): Promise<VolatilityPreview> {
    //     if (!this.contract) {
    //         throw new Error('Provider not available - pass provider during construction')
    //     }

    //     // try {
    //         // Determine target token based on useTargetToken flag
    //         const targetToken = this.spreadParams.useTargetToken ? makerAsset : takerAsset

    //         console.log('targetToken', targetToken)
            
    //         const result = await this.contract.previewSpread(
    //             targetToken.toString(),
    //             this.spreadParams.baseSpreadBps,
    //             this.spreadParams.volatilityMultiplier,
    //             this.spreadParams.maxSpreadBps,
    //             this.spreadParams.volatilityWindow
    //         )
    //         console.log('result', result)

    //         return {
    //             currentVolatility: BigInt(result[0]),
    //             dynamicSpread: BigInt(result[1]),
    //             targetToken: targetToken.toString(),
    //             spreadParams: this.spreadParams
    //         }
    //     // } catch (error: any) {

    //     //     console.error()
    //     //     throw new Error(`Failed to preview volatility: ${error.message}`)
    //     // }
    // }

    async previewVolatilitySpread(makerAsset: Address, takerAsset: Address): Promise<VolatilityPreview> {
        if (!this.contract) {
            throw new Error('Provider not available - pass provider during construction')
        }
    
        try {
            // Determine target token based on useTargetToken flag
            const targetToken = this.spreadParams.useTargetToken ? makerAsset : takerAsset;
            
            console.log('Calling previewSpread with params:', {
                tokenA: targetToken.toString(),
                baseSpreadBps: this.spreadParams.baseSpreadBps,
                volatilityMultiplier: this.spreadParams.volatilityMultiplier,
                maxSpreadBps: this.spreadParams.maxSpreadBps,
                volatilityWindow: this.spreadParams.volatilityWindow
            });
    
            // Explicitly call the contract with named parameters
            const result = await this.contract.previewSpread.staticCall(
                targetToken.toString(),
                this.spreadParams.baseSpreadBps,
                this.spreadParams.volatilityMultiplier,
                this.spreadParams.maxSpreadBps,
                this.spreadParams.volatilityWindow
            );
    
            console.log('Raw result from contract:', result);
    
            // Ensure we have both return values
            if (!result || result.length < 2) {
                throw new Error('Invalid return value from previewSpread');
            }
    
            return {
                currentVolatility: BigInt(result[0].toString()),
                dynamicSpread: BigInt(result[1].toString()),
                targetToken: targetToken.toString(),
                spreadParams: this.spreadParams
            };
        } catch (error: any) {
            console.error('Error in previewVolatilitySpread:', {
                error: error.message,
                stack: error.stack,
                code: error.code,
                reason: error.reason,
                data: error.data
            });
            throw new Error(`Failed to preview volatility: ${error.message}`);
        }
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
    static conservative(): SpreadParams {
        return {
            baseSpreadBps: 25,
            volatilityMultiplier: 100,
            maxSpreadBps: 150,
            volatilityWindow: 1,
            useTargetToken: false
        }
    }

    static moderate(): SpreadParams {
        return {
            baseSpreadBps: 50,
            volatilityMultiplier: 200,
            maxSpreadBps: 300,
            volatilityWindow: 0,
            useTargetToken: false
        }
    }

    static aggressive(): SpreadParams {
        return {
            baseSpreadBps: 100,
            volatilityMultiplier: 500,
            maxSpreadBps: 1000,
            volatilityWindow: 2,
            useTargetToken: false
        }
    }

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

// Contract ABI - minimal interface needed
const VOLATILITY_CALCULATOR_ABI = [
  {
      "type": "constructor",
      "inputs": [
          {
              "name": "_admin",
              "type": "address",
              "internalType": "address"
          }
      ],
      "stateMutability": "nonpayable"
  },
  {
      "type": "function",
      "name": "addTokenFeeds",
      "inputs": [
          {
              "name": "tokens",
              "type": "address[]",
              "internalType": "address[]"
          },
          {
              "name": "priceFeeds",
              "type": "address[]",
              "internalType": "address[]"
          },
          {
              "name": "isStablecoin",
              "type": "bool[]",
              "internalType": "bool[]"
          },
          {
              "name": "volatilityOverrides",
              "type": "uint256[]",
              "internalType": "uint256[]"
          }
      ],
      "outputs": [],
      "stateMutability": "nonpayable"
  },
  {
      "type": "function",
      "name": "admin",
      "inputs": [],
      "outputs": [
          {
              "name": "",
              "type": "address",
              "internalType": "address"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "function",
      "name": "encodeSpreadParams",
      "inputs": [
          {
              "name": "baseSpreadBps",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "_volatilityMultiplier",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "maxSpreadBps",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "volatilityWindow",
              "type": "uint8",
              "internalType": "uint8"
          },
          {
              "name": "useTargetToken",
              "type": "bool",
              "internalType": "bool"
          }
      ],
      "outputs": [
          {
              "name": "",
              "type": "bytes",
              "internalType": "bytes"
          }
      ],
      "stateMutability": "pure"
  },
  {
      "type": "function",
      "name": "getMakingAmount",
      "inputs": [
          {
              "name": "order",
              "type": "tuple",
              "internalType": "struct IOrderMixin.Order",
              "components": [
                  {
                      "name": "salt",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "maker",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "receiver",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "makerAsset",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "takerAsset",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "makingAmount",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "takingAmount",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "makerTraits",
                      "type": "uint256",
                      "internalType": "MakerTraits"
                  }
              ]
          },
          {
              "name": "",
              "type": "bytes",
              "internalType": "bytes"
          },
          {
              "name": "",
              "type": "bytes32",
              "internalType": "bytes32"
          },
          {
              "name": "",
              "type": "address",
              "internalType": "address"
          },
          {
              "name": "takingAmount",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "extraData",
              "type": "bytes",
              "internalType": "bytes"
          }
      ],
      "outputs": [
          {
              "name": "makingAmount",
              "type": "uint256",
              "internalType": "uint256"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "function",
      "name": "getTakingAmount",
      "inputs": [
          {
              "name": "order",
              "type": "tuple",
              "internalType": "struct IOrderMixin.Order",
              "components": [
                  {
                      "name": "salt",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "maker",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "receiver",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "makerAsset",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "takerAsset",
                      "type": "uint256",
                      "internalType": "Address"
                  },
                  {
                      "name": "makingAmount",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "takingAmount",
                      "type": "uint256",
                      "internalType": "uint256"
                  },
                  {
                      "name": "makerTraits",
                      "type": "uint256",
                      "internalType": "MakerTraits"
                  }
              ]
          },
          {
              "name": "",
              "type": "bytes",
              "internalType": "bytes"
          },
          {
              "name": "",
              "type": "bytes32",
              "internalType": "bytes32"
          },
          {
              "name": "",
              "type": "address",
              "internalType": "address"
          },
          {
              "name": "makingAmount",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "extraData",
              "type": "bytes",
              "internalType": "bytes"
          }
      ],
      "outputs": [
          {
              "name": "takingAmount",
              "type": "uint256",
              "internalType": "uint256"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "function",
      "name": "previewSpread",
      "inputs": [
          {
              "name": "tokenA",
              "type": "address",
              "internalType": "address"
          },
          {
              "name": "baseSpreadBps",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "volatilityMultiplier",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "maxSpreadBps",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "volatilityWindow",
              "type": "uint8",
              "internalType": "uint8"
          }
      ],
      "outputs": [
          {
              "name": "currentVolatility",
              "type": "uint256",
              "internalType": "uint256"
          },
          {
              "name": "dynamicSpread",
              "type": "uint256",
              "internalType": "uint256"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "function",
      "name": "previewVolatility",
      "inputs": [
          {
              "name": "token",
              "type": "address",
              "internalType": "address"
          },
          {
              "name": "volatilityWindow",
              "type": "uint8",
              "internalType": "uint8"
          }
      ],
      "outputs": [
          {
              "name": "currentVolatility",
              "type": "uint256",
              "internalType": "uint256"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "function",
      "name": "resolveExtension",
      "inputs": [
          {
              "name": "",
              "type": "address",
              "internalType": "address"
          },
          {
              "name": "extension",
              "type": "bytes",
              "internalType": "bytes"
          }
      ],
      "outputs": [
          {
              "name": "",
              "type": "bytes",
              "internalType": "bytes"
          }
      ],
      "stateMutability": "view"
  },
  {
      "type": "event",
      "name": "SpreadCalculated",
      "inputs": [
          {
              "name": "orderHash",
              "type": "bytes32",
              "indexed": true,
              "internalType": "bytes32"
          },
          {
              "name": "token",
              "type": "address",
              "indexed": true,
              "internalType": "address"
          },
          {
              "name": "volatility",
              "type": "uint256",
              "indexed": false,
              "internalType": "uint256"
          },
          {
              "name": "dynamicSpread",
              "type": "uint256",
              "indexed": false,
              "internalType": "uint256"
          },
          {
              "name": "adjustedAmount",
              "type": "uint256",
              "indexed": false,
              "internalType": "uint256"
          }
      ],
      "anonymous": false
  },
  {
      "type": "error",
      "name": "InvalidParam",
      "inputs": []
  },
  {
      "type": "error",
      "name": "RestrictedOperation",
      "inputs": []
  },
  {
      "type": "error",
      "name": "SpreadTooHigh",
      "inputs": []
  },
  {
      "type": "error",
      "name": "TokenNotSupported",
      "inputs": []
  }
]