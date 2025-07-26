 
    // Simple parameters - no token addresses needed!
    struct SpreadParams {
        uint256 baseSpreadBps;        // Base spread (e.g., 50 = 0.5%)
        uint256 volatilityMultiplier; // How volatility affects spread (e.g., 200 = 2x)
        uint256 maxSpreadBps;         // Maximum spread (e.g., 200 = 2%)
        uint8 volatilityWindow;       // 0=24h, 1=7d, 2=blended
        bool useTargetToken;          // true=use makerAsset, false=use takerAsset for volatility
    }

    // Chainlink feed addresses for each token
    struct TokenFeeds {
        AggregatorV3Interface volatility24h;
        AggregatorV3Interface volatility7d;
        AggregatorV3Interface priceFeed;
        bool isSupported;
    }
    
    // ============ STATE VARIABLES ============
    
    // Map each supported token to its Chainlink feeds
    mapping(address => TokenFeeds) public tokenFeeds;
    
    // Supported major tokens
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address public constant WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address public constant USDC = 0xA0b86a33E6441b24d1af8c61b5bc4FD4b15a;
    address public constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address public constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address public constant LINK = 0x514910771AF9Ca656af840dff83E8264EcF986CA;

    // ============ CONSTRUCTOR ============
    
    constructor() {
        _setupTokenFeeds();
    }
    
    function _setupTokenFeeds() internal {
        // ETH feeds
        tokenFeeds[WETH] = TokenFeeds({
            // Update these with real Chainlink volatility feed addresses
            volatility24h: AggregatorV3Interface(0x0000000000000000000000000000000000000001), // ETH 24h Vol
            volatility7d: AggregatorV3Interface(0x0000000000000000000000000000000000000002),  // ETH 7d Vol
            priceFeed: AggregatorV3Interface(0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419),     // ETH/USD Real
            isSupported: true
        });
        
        // BTC feeds  
        tokenFeeds[WBTC] = TokenFeeds({
            volatility24h: AggregatorV3Interface(0x0000000000000000000000000000000000000003), // BTC 24h Vol
            volatility7d: AggregatorV3Interface(0x0000000000000000000000000000000000000004),  // BTC 7d Vol
            priceFeed: AggregatorV3Interface(0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c),     // BTC/USD Real
            isSupported: true
        });
        
        // LINK feeds
        tokenFeeds[LINK] = TokenFeeds({
            volatility24h: AggregatorV3Interface(0x0000000000000000000000000000000000000005), // LINK 24h Vol  
            volatility7d: AggregatorV3Interface(0x0000000000000000000000000000000000000006),  // LINK 7d Vol
            priceFeed: AggregatorV3Interface(0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c),     // LINK/USD Real
            isSupported: true
        });
        
        // Stablecoins - no volatility feeds needed, use low default volatility
        tokenFeeds[USDC] = TokenFeeds({
            volatility24h: AggregatorV3Interface(address(0)), // No vol feed
            volatility7d: AggregatorV3Interface(address(0)),
            priceFeed: AggregatorV3Interface(0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6),     // USDC/USD Real
            isSupported: true
        });
        
        tokenFeeds[USDT] = TokenFeeds({
            volatility24h: AggregatorV3Interface(address(0)),
            volatility7d: AggregatorV3Interface(address(0)),
            priceFeed: AggregatorV3Interface(0x3E7d1eAB13ad0104d2750B8863b489D65364e32D),     // USDT/USD Real
            isSupported: true
        });
        
        tokenFeeds[DAI] = TokenFeeds({
            volatility24h: AggregatorV3Interface(address(0)),
            volatility7d: AggregatorV3Interface(address(0)),
            priceFeed: AggregatorV3Interface(0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9),     // DAI/USD Real
            isSupported: true
        });
    }

    // ============ MAIN FUNCTIONS ============

    /**
     * @notice Calculate taking amount with dynamic spread
     * @dev Token info comes from order.makerAsset and order.takerAsset!
     */
    function getTakingAmount(
        IOrderMixin.Order calldata order,
        bytes calldata /* extension */,
        bytes32 orderHash,
        address /* taker */,
        uint256 makingAmount,
        uint256 /* remainingMakingAmount */,
        bytes calldata extraData
    ) external view returns (uint256 takingAmount) {
        SpreadParams memory params = _decodeExtraData(extraData);
        
        // Determine which token to use for volatility calculation
        address targetToken = params.useTargetToken ? order.makerAsset : order.takerAsset;
        
        // Get volatility for the target token
        uint256 currentVolatility = _getTokenVolatility(targetToken, params.volatilityWindow);
        
        // Calculate dynamic spread
        uint256 dynamicSpread = _calculateDynamicSpread(
            params.baseSpreadBps,
            params.volatilityMultiplier,
            params.maxSpreadBps,
            currentVolatility
        );
        
        // Apply spread to taking amount
        uint256 originalTakingAmount = (order.takingAmount * makingAmount) / order.makingAmount;
        takingAmount = originalTakingAmount + (originalTakingAmount * dynamicSpread / BASIS_POINTS);
        
        emit SpreadCalculated(orderHash, targetToken, currentVolatility, dynamicSpread, takingAmount);
    }

    /**
     * @notice Calculate making amount with dynamic spread
     */
    function getMakingAmount(
        IOrderMixin.Order calldata order,
        bytes calldata /* extension */,
        bytes32 orderHash,
        address /* taker */,
        uint256 takingAmount,
        uint256 /* remainingMakingAmount */,
        bytes calldata extraData
    ) external view returns (uint256 makingAmount) {
        SpreadParams memory params = _decodeExtraData(extraData);
        
        // Determine which token to use for volatility calculation
        address targetToken = params.useTargetToken ? order.makerAsset : order.takerAsset;
        
        // Get volatility for the target token
        uint256 currentVolatility = _getTokenVolatility(targetToken, params.volatilityWindow);
        
        // Calculate dynamic spread
        uint256 dynamicSpread = _calculateDynamicSpread(
            params.baseSpreadBps,
            params.volatilityMultiplier,
            params.maxSpreadBps,
            currentVolatility
        );
        
        // Apply spread to making amount
        uint256 originalMakingAmount = (order.makingAmount * takingAmount) / order.takingAmount;
        makingAmount = originalMakingAmount - (originalMakingAmount * dynamicSpread / BASIS_POINTS);
        
        emit SpreadCalculated(orderHash, targetToken, currentVolatility, dynamicSpread, makingAmount);
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Get volatility for a specific token
     */
    function _getTokenVolatility(address token, uint8 window) internal view returns (uint256) {
        TokenFeeds memory feeds = tokenFeeds[token];
        require(feeds.isSupported, "Token not supported");
        
        // For stablecoins, return low volatility
        if (token == USDC || token == USDT || token == DAI) {
            return 200; // 2% volatility for stables
        }
        
        // For other tokens, use Chainlink volatility feeds
        AggregatorV3Interface volatilityFeed;
        if (window == 0) {
            volatilityFeed = feeds.volatility24h;
        } else if (window == 1) {
            volatilityFeed = feeds.volatility7d;
        } else {
            // Blended: 70% 24h + 30% 7d
            uint256 vol24h = _getVolatilityFromFeed(feeds.volatility24h);
            uint256 vol7d = _getVolatilityFromFeed(feeds.volatility7d);
            return (vol24h * 70 + vol7d * 30) / 100;
        }
        
        return _getVolatilityFromFeed(volatilityFeed);
    }

    /**
     * @dev Get volatility from a Chainlink feed
     */
    function _getVolatilityFromFeed(AggregatorV3Interface feed) internal view returns (uint256) {
        if (address(feed) == address(0)) {
            return 3000; // Default 30% volatility if no feed
        }
        
        try feed.latestRoundData() returns (
            uint80, int256 volatility, uint256, uint256 updatedAt, uint80
        ) {
            require(volatility > 0, "Invalid volatility");
            require(block.timestamp - updatedAt <= 3600, "Stale volatility data");
            
            return uint256(volatility); // Chainlink returns volatility in basis points
        } catch {
            return 3000; // Fallback volatility
        }
    }

    /**
     * @dev Calculate dynamic spread based on volatility
     */
    function _calculateDynamicSpread(
        uint256 baseSpreadBps,
        uint256 volatilityMultiplier,
        uint256 maxSpreadBps,
        uint256 currentVolatility
    ) internal pure returns (uint256) {
        // Convert volatility from basis points to percentage
        uint256 volatilityPct = currentVolatility / 100;
        
        // Calculate volatility impact
        uint256 volatilityImpact = (volatilityPct * volatilityMultiplier) / 100;
        
        // Add to base spread
        uint256 dynamicSpread = baseSpreadBps + volatilityImpact;
        
        // Cap at maximum spread
        return Math.min(dynamicSpread, maxSpreadBps);
    }

    /**
     * @dev Decode extraData into SpreadParams
     */
    function _decodeExtraData(bytes calldata extraData) internal pure returns (SpreadParams memory) {
        return abi.decode(extraData, (SpreadParams));
    }

    // ============ VIEW FUNCTIONS ============

    /**
     * @notice Check if a token is supported
     */
    function isTokenSupported(address token) external view returns (bool) {
        return tokenFeeds[token].isSupported;
    }