// src/VolatilityOrderManager.ts
import {ethers, Contract, Provider, Wallet, ContractTransactionResponse} from 'ethers'
import {LimitOrderBuilder, LimitOrderProtocolFacade} from '@1inch/limit-order-protocol-utils'
import {VolatilitySpreadExtension, SpreadParams} from './limit-order/extensions/volatility-spread'
import {Address} from './address'
import fs from 'fs/promises'
import path from 'path'

/**
 * Local Order Management System for Volatility Orders
 * 
 * Handles:
 * - Order creation with volatility extensions
 * - Local storage (file system or memory)
 * - Order lifecycle management (active, filled, cancelled)
 * - Order discovery and filtering
 * - Filling orders without 1inch orderbook
 */
export class VolatilityOrderManager {
  private provider: Provider
  private limitOrderBuilder: LimitOrderBuilder
  private limitOrderProtocol: LimitOrderProtocolFacade
  private volatilityContract: Contract
  private contractAddress: string
  private storageType: 'memory' | 'file' | 'mongodb'
  private storageConfig: any

  // In-memory storage
  private orders: Map<string, VolatilityOrderData> = new Map()
  private ordersByMaker: Map<string, Set<string>> = new Map()
  private ordersByStatus: Map<OrderStatus, Set<string>> = new Map()

  constructor(config: VolatilityOrderManagerConfig) {
    this.provider = config.provider
    this.contractAddress = config.volatilityContractAddress
    this.storageType = config.storageType || 'memory'
    this.storageConfig = config.storageConfig || {}

    // Initialize 1inch components
    this.limitOrderBuilder = new LimitOrderBuilder(
      config.limitOrderProtocolAddress,
      config.chainId
    )
    
    this.limitOrderProtocol = new LimitOrderProtocolFacade(
      config.limitOrderProtocolAddress,
      config.provider
    )

    // Initialize volatility contract
    this.volatilityContract = new Contract(
      config.volatilityContractAddress,
      VOLATILITY_CALCULATOR_ABI,
      config.provider
    )

    // Initialize storage indexes
    Object.values(OrderStatus).forEach(status => {
      this.ordersByStatus.set(status, new Set())
    })

    // Load existing orders if using file storage
    if (this.storageType === 'file') {
      this.loadOrdersFromFile().catch(console.error)
    }
  }

  /**
   * Create and store a new volatility order
   */
  async createOrder(params: CreateVolatilityOrderParams): Promise<VolatilityOrderData> {
    const {
      maker,
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      targetToken,
      spreadParams,
      wallet,
      receiver,
      expiration,
      nonce
    } = params

    console.log(`📝 Creating volatility order for ${maker}...`)

    // Create volatility extension
    const extension = VolatilitySpreadExtension.new(
      new Address(this.contractAddress),
      new Address(targetToken),
      spreadParams,
      this.provider
    )

    // Preview volatility (optional)
    let preview: any = null
    try {
      preview = await extension.previewVolatilitySpread()
      console.log(`   Current volatility: ${ethers.formatUnits(preview.currentVolatility.toString(), 2)}%`)
      console.log(`   Dynamic spread: ${ethers.formatUnits(preview.dynamicSpread.toString(), 2)}%`)
    } catch (error: any) {
      console.log(`   Preview unavailable: ${error.message}`)
    }

    // Build order parameters
    const orderParams: any = {
      makerAsset,
      takerAsset,
      makingAmount,
      takingAmount,
      maker,
      receiver: receiver || maker,
      extension: extension.build().encode()
    }

    // Add optional parameters
    if (expiration) {
      orderParams.expiration = Math.floor(expiration.getTime() / 1000)
    }
    if (nonce !== undefined) {
      orderParams.nonce = nonce
    }

    // Create order
    const order = this.limitOrderBuilder.buildLimitOrder(orderParams)

    // Sign order
    const orderTypedData = this.limitOrderBuilder.buildLimitOrderTypedData(order)
    const signature = await wallet.signTypedData(
      orderTypedData.domain,
      orderTypedData.types,
      orderTypedData.message
    )

    // Calculate order hash
    const orderHash = this.limitOrderBuilder.buildLimitOrderHash(order)

    // Create order data
    const orderData: VolatilityOrderData = {
      orderHash,
      order,
      signature,
      targetToken,
      spreadParams,
      extension: extension.build().encode(),
      status: OrderStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        extensionInfo: extension.getInfo(),
        expectedVolatility: preview?.currentVolatility ? Number(preview.currentVolatility) : 0,
        calculatedSpread: preview?.dynamicSpread ? Number(preview.dynamicSpread) : 0,
        originalRate: this.calculateRate(makingAmount, takingAmount),
      }
    }

    // Store order
    await this.storeOrder(orderData)

    console.log(`✅ Order created: ${orderHash}`)
    return orderData
  }

  /**
   * Fill an order from local storage
   */
  async fillOrder(
    orderHash: string,
    taker: Wallet,
    fillAmount?: string,
    fillType: 'making' | 'taking' = 'making'
  ): Promise<ContractTransactionResponse> {
    console.log(`🔄 Filling order ${orderHash}...`)

    // Get order from storage
    const orderData = await this.getOrder(orderHash)
    if (!orderData) {
      throw new Error(`Order not found: ${orderHash}`)
    }

    if (orderData.status !== OrderStatus.ACTIVE) {
      throw new Error(`Order is ${orderData.status}, cannot fill`)
    }

    // Determine fill amount
    const amount = fillAmount || (fillType === 'making' ? orderData.order.makingAmount : orderData.order.takingAmount)

    console.log(`   Fill amount: ${amount}`)
    console.log(`   Fill type: ${fillType}`)

    // Connect taker wallet to protocol
    const limitOrderWithTaker = this.limitOrderProtocol.connectWallet(taker)

    // Fill order
    const tx = await limitOrderWithTaker.fillLimitOrder(
      orderData.order,
      orderData.signature,
      amount,
      '0x', // thresholdAmount
      '0x'  // interaction
    )

    console.log(`   Transaction hash: ${tx.hash}`)

    // Update order status
    await this.updateOrderStatus(orderHash, OrderStatus.FILLED)

    console.log(`✅ Order filled successfully`)
    return tx
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderHash: string, maker: Wallet): Promise<ContractTransactionResponse> {
    console.log(`❌ Cancelling order ${orderHash}...`)

    const orderData = await this.getOrder(orderHash)
    if (!orderData) {
      throw new Error(`Order not found: ${orderHash}`)
    }

    if (orderData.status !== OrderStatus.ACTIVE) {
      throw new Error(`Order is ${orderData.status}, cannot cancel`)
    }

    // Connect maker wallet to protocol
    const limitOrderWithMaker = this.limitOrderProtocol.connectWallet(maker)

    // Cancel order on-chain
    const tx = await limitOrderWithMaker.cancelLimitOrder(orderData.order)

    // Update order status
    await this.updateOrderStatus(orderHash, OrderStatus.CANCELLED)

    console.log(`✅ Order cancelled: ${tx.hash}`)
    return tx
  }

  /**
   * Get order by hash
   */
  async getOrder(orderHash: string): Promise<VolatilityOrderData | null> {
    if (this.storageType === 'memory') {
      return this.orders.get(orderHash) || null
    } else if (this.storageType === 'file') {
      return this.orders.get(orderHash) || null
    }
    // Add MongoDB implementation here if needed
    return null
  }

  /**
   * Get orders with filtering
   */
  async getOrders(filter: OrderFilter = {}): Promise<VolatilityOrderData[]> {
    let results: VolatilityOrderData[] = []

    if (this.storageType === 'memory' || this.storageType === 'file') {
      results = Array.from(this.orders.values())
    }

    // Apply filters
    if (filter.maker) {
      results = results.filter(order => order.order.maker.toLowerCase() === filter.maker!.toLowerCase())
    }

    if (filter.status) {
      results = results.filter(order => order.status === filter.status)
    }

    if (filter.makerAsset) {
      results = results.filter(order => order.order.makerAsset.toLowerCase() === filter.makerAsset!.toLowerCase())
    }

    if (filter.takerAsset) {
      results = results.filter(order => order.order.takerAsset.toLowerCase() === filter.takerAsset!.toLowerCase())
    }

    if (filter.targetToken) {
      results = results.filter(order => order.targetToken.toLowerCase() === filter.targetToken!.toLowerCase())
    }

    if (filter.createdAfter) {
      results = results.filter(order => order.createdAt >= filter.createdAfter!)
    }

    if (filter.createdBefore) {
      results = results.filter(order => order.createdAt <= filter.createdBefore!)
    }

    // Sort by creation date (newest first)
    results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

    return results
  }

  /**
   * Get active orders for a maker
   */
  async getActiveOrdersForMaker(maker: string): Promise<VolatilityOrderData[]> {
    return this.getOrders({ maker, status: OrderStatus.ACTIVE })
  }

  /**
   * Update volatility for active orders and return orders with significant changes
   */
  async checkVolatilityUpdates(thresholdBps: number = 50): Promise<VolatilityUpdateResult[]> {
    console.log(`🔍 Checking volatility updates (threshold: ${thresholdBps / 100}%)...`)

    const activeOrders = await this.getOrders({ status: OrderStatus.ACTIVE })
    const updates: VolatilityUpdateResult[] = []

    for (const orderData of activeOrders) {
      try {
        // Create extension to check current volatility
        const extension = VolatilitySpreadExtension.new(
          new Address(this.contractAddress),
          new Address(orderData.targetToken),
          orderData.spreadParams,
          this.provider
        )

        const currentPreview = await extension.previewVolatilitySpread()
        const currentVolatility = Number(currentPreview.currentVolatility)
        const originalVolatility = orderData.metadata.expectedVolatility || 0

        const volatilityChange = Math.abs(currentVolatility - originalVolatility)

        if (volatilityChange >= thresholdBps) {
          updates.push({
            orderHash: orderData.orderHash,
            originalVolatility,
            currentVolatility,
            volatilityChange,
            originalSpread: orderData.metadata.calculatedSpread || 0,
            currentSpread: Number(currentPreview.dynamicSpread)
          })
        }
      } catch (error: any) {
        console.error(`Error checking volatility for order ${orderData.orderHash}:`, error.message)
      }
    }

    console.log(`📊 Found ${updates.length} orders with significant volatility changes`)
    return updates
  }

  /**
   * Get statistics about stored orders
   */
  async getOrderStats(): Promise<OrderStats> {
    const allOrders = await this.getOrders()
    
    const stats: OrderStats = {
      total: allOrders.length,
      active: 0,
      filled: 0,
      cancelled: 0,
      expired: 0,
      byMaker: new Map(),
      byTargetToken: new Map(),
      totalVolume: 0n
    }

    for (const order of allOrders) {
      // Count by status
      switch (order.status) {
        case OrderStatus.ACTIVE:
          stats.active++
          break
        case OrderStatus.FILLED:
          stats.filled++
          break
        case OrderStatus.CANCELLED:
          stats.cancelled++
          break
        case OrderStatus.EXPIRED:
          stats.expired++
          break
      }

      // Count by maker
      const makerCount = stats.byMaker.get(order.order.maker) || 0
      stats.byMaker.set(order.order.maker, makerCount + 1)

      // Count by target token
      const tokenCount = stats.byTargetToken.get(order.targetToken) || 0
      stats.byTargetToken.set(order.targetToken, tokenCount + 1)

      // Add to total volume (if filled)
      if (order.status === OrderStatus.FILLED) {
        stats.totalVolume = stats.totalVolume + ethers.getBigInt(order.order.takingAmount)
      }
    }

    return stats
  }

  // ============ PRIVATE METHODS ============

  private async storeOrder(orderData: VolatilityOrderData): Promise<void> {
    // Store in memory
    this.orders.set(orderData.orderHash, orderData)

    // Update indexes
    const makerOrders = this.ordersByMaker.get(orderData.order.maker) || new Set()
    makerOrders.add(orderData.orderHash)
    this.ordersByMaker.set(orderData.order.maker, makerOrders)

    const statusOrders = this.ordersByStatus.get(orderData.status) || new Set()
    statusOrders.add(orderData.orderHash)
    this.ordersByStatus.set(orderData.status, statusOrders)

    // Persist to file if using file storage
    if (this.storageType === 'file') {
      await this.saveOrdersToFile()
    }
  }

  private async updateOrderStatus(orderHash: string, newStatus: OrderStatus): Promise<void> {
    const orderData = this.orders.get(orderHash)
    if (!orderData) return

    // Update status indexes
    const oldStatusOrders = this.ordersByStatus.get(orderData.status)
    if (oldStatusOrders) {
      oldStatusOrders.delete(orderHash)
    }

    const newStatusOrders = this.ordersByStatus.get(newStatus) || new Set()
    newStatusOrders.add(orderHash)
    this.ordersByStatus.set(newStatus, newStatusOrders)

    // Update order data
    orderData.status = newStatus
    orderData.updatedAt = new Date()

    // Persist changes
    if (this.storageType === 'file') {
      await this.saveOrdersToFile()
    }
  }

  private async loadOrdersFromFile(): Promise<void> {
    try {
      const filePath = this.getStorageFilePath()
      const data = await fs.readFile(filePath, 'utf8')
      const ordersArray: VolatilityOrderData[] = JSON.parse(data)

      for (const orderData of ordersArray) {
        // Convert date strings back to Date objects
        orderData.createdAt = new Date(orderData.createdAt)
        orderData.updatedAt = new Date(orderData.updatedAt)
        
        await this.storeOrder(orderData)
      }

      console.log(`📁 Loaded ${ordersArray.length} orders from file`)
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error(`Error loading orders from file:`, error)
      }
    }
  }

  private async saveOrdersToFile(): Promise<void> {
    try {
      const filePath = this.getStorageFilePath()
      const ordersArray = Array.from(this.orders.values())
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      
      // Save to file
      await fs.writeFile(filePath, JSON.stringify(ordersArray, null, 2))
    } catch (error: any) {
      console.error(`Error saving orders to file:`, error)
    }
  }

  private getStorageFilePath(): string {
    const dataDir = this.storageConfig.dataDirectory || './data'
    return path.join(dataDir, 'volatility-orders.json')
  }

  private calculateRate(makingAmount: string, takingAmount: string): string {
    const making = ethers.getBigInt(makingAmount)
    const taking = ethers.getBigInt(takingAmount)
    return ((taking * ethers.parseEther('1')) / making).toString()
  }
}

// ============ TYPES ============

export interface VolatilityOrderManagerConfig {
  provider: Provider
  volatilityContractAddress: string
  limitOrderProtocolAddress: string
  chainId: number
  storageType?: 'memory' | 'file' | 'mongodb'
  storageConfig?: {
    dataDirectory?: string
    mongoUrl?: string
    dbName?: string
  }
}

export interface CreateVolatilityOrderParams {
  maker: string
  makerAsset: string
  takerAsset: string
  makingAmount: string
  takingAmount: string
  targetToken: string
  spreadParams: SpreadParams
  wallet: Wallet
  receiver?: string
  expiration?: Date
  nonce?: number
}

export interface VolatilityOrderData {
  orderHash: string
  order: any // 1inch Order type
  signature: string
  targetToken: string
  spreadParams: SpreadParams
  extension: string
  status: OrderStatus
  createdAt: Date
  updatedAt: Date
  metadata: {
    extensionInfo: string
    expectedVolatility: number
    calculatedSpread: number
    originalRate: string
  }
}

export enum OrderStatus {
  ACTIVE = 'active',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired'
}

export interface OrderFilter {
  maker?: string
  status?: OrderStatus
  makerAsset?: string
  takerAsset?: string
  targetToken?: string
  createdAfter?: Date
  createdBefore?: Date
}

export interface VolatilityUpdateResult {
  orderHash: string
  originalVolatility: number
  currentVolatility: number
  volatilityChange: number
  originalSpread: number
  currentSpread: number
}

export interface OrderStats {
  total: number
  active: number
  filled: number
  cancelled: number
  expired: number
  byMaker: Map<string, number>
  byTargetToken: Map<string, number>
  totalVolume: bigint
}

// Contract ABI
const VOLATILITY_CALCULATOR_ABI = [
  'function previewSpread(address tokenA, uint256 baseSpreadBps, uint256 volatilityMultiplier, uint256 maxSpreadBps, uint8 volatilityWindow) external view returns (uint256 currentVolatility, uint256 dynamicSpread)',
  'function previewVolatility(address token, uint8 volatilityWindow) external view returns (uint256 currentVolatility)'
]