// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import {IAggregatorV3Interface} from "../interfaces/IAggregatorV3Interface.sol";

library ChainlinkVolatilityLib {
    //struct
    struct VolatilityStorage {
        mapping(address => TokenFeeds) tokenfeeds;
    }

    struct TokenFeeds {
        IAggregatorV3Interface volatility24h;
        IAggregatorV3Interface volatility7d;
        IAggregatorV3Interface priceFeed;
        bool isSupported;
    }

    uint256 public constant STABLECOIN_VOLATILITY = 100;
    uint256 public constant DEFAULT_VOLATILITY = 3000;
    uint256 public constant MAX_STALENESS = 3600; // 1 hour max staleness

    // ============ ERRORS ============

    error TokenNotSupported();
    error InvalidVolatility();
    error StaleVolatilityData();

    function setUpTokenFeeds(
        address[] calldata token,
        address[] calldata volatility24h,
        address[] calldata volatility7d,
        address[] calldata priceFeed,
        VolatilityStorage storage self
    ) internal returns (TokenFeeds memory) {
        for (uint256 i = 0; i < token.length; i++) {
            self.tokenfeeds[token[i]] = TokenFeeds({
                volatility24h: IAggregatorV3Interface(volatility24h[i]),
                volatility7d: IAggregatorV3Interface(volatility7d[i]),
                priceFeed: IAggregatorV3Interface(priceFeed[i]),
                isSupported: true
            });
        }
    }

    //========CORE FUNCTIONS=============
    function getTokenVolatility(VolatilityStorage storage self, address token, uint8 window)
        internal
        view
        returns (uint256 volatility)
    {
        TokenFeeds memory feeds = self.tokenfeeds[token];
        if (!feeds.isSupported) revert TokenNotSupported();

        // For stablecoins, return low volatility
        if (address(feeds.volatility24h) == address(0) || address(feeds.volatility7d) == address(0)) {
            return STABLECOIN_VOLATILITY;
        }

        // For other tokens, use Chainlink volatility feeds
        IAggregatorV3Interface volatilityFeed;
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
     * @dev Check if a token is supported
     * @param self Storage pointer for the volatility data
     * @param token Token address to check
     * @return supported True if token is supported
     */
    function isTokenSupported(VolatilityStorage storage self, address token) internal view returns (bool supported) {
        return self.tokenfeeds[token].isSupported;
    }

    /**
     * @dev Update token feeds (admin function)
     * @param self Storage pointer for the volatility data
     * @param token Token address to update
     * @param volatility24h 24h volatility feed address
     * @param volatility7d 7d volatility feed address
     * @param priceFeed Price feed address
     */
    function updateTokenFeed(
        VolatilityStorage storage self,
        address token,
        IAggregatorV3Interface volatility24h,
        IAggregatorV3Interface volatility7d,
        IAggregatorV3Interface priceFeed
    ) internal {
        self.tokenfeeds[token] = TokenFeeds({
            volatility24h: volatility24h,
            volatility7d: volatility7d,
            priceFeed: priceFeed,
            isSupported: true
        });
    }

    // ============ INTERNAL FUNCTIONS ============

    /**
     * @dev Get volatility from a Chainlink feed
     * @param feed Chainlink aggregator interface
     * @return volatility Volatility in basis points
     */
    function _getVolatilityFromFeed(IAggregatorV3Interface feed) private view returns (uint256 volatility) {
        if (address(feed) == address(0)) {
            return DEFAULT_VOLATILITY; // Default volatility if no feed
        }

        try feed.latestRoundData() returns (uint80, int256 _volatility, uint256, uint256 updatedAt, uint80) {
            if (_volatility <= 0) revert InvalidVolatility();
            if (block.timestamp - updatedAt > MAX_STALENESS) revert StaleVolatilityData();

            return uint256(_volatility); // Chainlink returns volatility in basis points
        } catch {
            return DEFAULT_VOLATILITY; // Fallback volatility
        }
    }

    /**
     * @dev Preview volatility for a token
     * @param self Storage pointer for the volatility data
     * @param token Token address
     * @param window Volatility window (0=24h, 1=7d, 2=blended)
     * @return currentVolatility Current volatility in basis points
     */
    function previewVolatility(VolatilityStorage storage self, address token, uint8 window)
        internal
        view
        returns (uint256 currentVolatility)
    {
        return getTokenVolatility(self, token, window);
    }
}
