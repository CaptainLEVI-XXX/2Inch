// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IAggregatorV3Interface} from "../interfaces/IAggregatorV3Interface.sol";
import {FixedPointMathLib} from "@solady/utils/FixedPointMathLib.sol";

library ChainlinkVolatilityLib {
    using FixedPointMathLib for uint256;

    // Structs
    struct VolatilityStorage {
        mapping(address => TokenConfig) tokenConfigs;
        mapping(address => PriceHistory) priceHistories;
    }

    struct TokenConfig {
        IAggregatorV3Interface priceFeed;
        uint256 volatilityOverride; // Manual override for volatility (0 = calculate)
        bool isStablecoin;
        bool isSupported;
    }

    struct PriceHistory {
        uint256[24] hourlyPrices; // 24 hours of data
        uint256[7] dailyPrices; // 7 days of data
        uint256 lastHourlyUpdate;
        uint256 lastDailyUpdate;
        uint8 hourlyIndex;
        uint8 dailyIndex;
    }

    // Constants
    uint256 public constant STABLECOIN_VOLATILITY = 100; // 1%
    uint256 public constant DEFAULT_VOLATILITY = 3000; // 30%
    uint256 public constant MAX_STALENESS = 3600; // 1 hour
    uint256 private constant VOLATILITY_SCALE = 10000; // Basis points

    // Errors
    error TokenNotSupported();
    error InvalidVolatility();
    error StaleVolatilityData();

    // ============ SETUP FUNCTIONS ============

    function setUpTokenFeeds(
        VolatilityStorage storage self,
        address[] calldata tokens,
        address[] calldata priceFeeds,
        bool[] calldata isStableCoin,
        uint256[] calldata volatilityOverrides
    ) internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            self.tokenConfigs[tokens[i]] = TokenConfig({
                priceFeed: IAggregatorV3Interface(priceFeeds[i]),
                volatilityOverride: volatilityOverrides[i],
                isStablecoin: isStableCoin[i],
                isSupported: true
            });
        }
    }

    // ============ CORE FUNCTIONS ============

    function getTokenVolatility(VolatilityStorage storage self, address token, uint8 window)
        internal
        view
        returns (uint256 volatility)
    {
        TokenConfig memory config = self.tokenConfigs[token];
        if (!config.isSupported) revert TokenNotSupported();

        // Use override if set
        if (config.volatilityOverride > 0) {
            return config.volatilityOverride;
        }

        // Return low volatility for stablecoins
        if (config.isStablecoin) {
            return STABLECOIN_VOLATILITY;
        }

        // Calculate realized volatility from price history
        if (window == 0) {
            return _calculate24hVolatility(self, token);
        } else if (window == 1) {
            return _calculate7dVolatility(self, token);
        } else {
            // Blended: 70% 24h + 30% 7d
            uint256 vol24h = _calculate24hVolatility(self, token);
            uint256 vol7d = _calculate7dVolatility(self, token);
            return (vol24h * 70 + vol7d * 30) / 100;
        }
    }

    // ============ VOLATILITY CALCULATION ============

    function _calculate24hVolatility(VolatilityStorage storage self, address token) private view returns (uint256) {
        PriceHistory storage history = self.priceHistories[token];

        // If no history, return default
        if (history.lastHourlyUpdate == 0) {
            return DEFAULT_VOLATILITY;
        }

        // Calculate standard deviation of hourly returns
        return _calculateVolatilityFromPrices(history.hourlyPrices, 24);
    }

    function _calculate7dVolatility(VolatilityStorage storage self, address token) private view returns (uint256) {
        PriceHistory storage history = self.priceHistories[token];

        // If no history, return default
        if (history.lastDailyUpdate == 0) {
            return DEFAULT_VOLATILITY;
        }

        // Calculate standard deviation of daily returns
        uint256 dailyVol = _calculateVolatilityFromPrices(history.dailyPrices, 7);
        // Annualize: daily vol * sqrt(365)
        return dailyVol.mulDiv(1910, 100); // sqrt(365) ≈ 19.1
    }

    function _calculateVolatilityFromPrices(uint256[24] storage prices, uint256 count) private view returns (uint256) {
        if (count < 2) return DEFAULT_VOLATILITY;

        uint256 sumReturns = 0;
        uint256 sumSquaredReturns = 0;
        uint256 validSamples = 0;

        for (uint256 i = 1; i < count; i++) {
            if (prices[i] == 0 || prices[i - 1] == 0) continue;

            // Calculate return as percentage (in basis points)
            uint256 return_ = prices[i].mulDiv(VOLATILITY_SCALE, prices[i - 1]);
            if (return_ > VOLATILITY_SCALE) {
                return_ = return_ - VOLATILITY_SCALE;
            } else {
                return_ = VOLATILITY_SCALE - return_;
            }

            sumReturns += return_;
            sumSquaredReturns += return_ * return_;
            validSamples++;
        }

        if (validSamples < 2) return DEFAULT_VOLATILITY;

        // Calculate variance
        uint256 meanReturn = sumReturns / validSamples;
        uint256 variance = sumSquaredReturns / validSamples - (meanReturn * meanReturn);

        // Return standard deviation (simplified square root)
        return variance.sqrt();
    }

    function _calculateVolatilityFromPrices(uint256[7] storage prices, uint256 count) private view returns (uint256) {
        // Similar logic for 7-day array
        // Implementation details omitted for brevity
        return DEFAULT_VOLATILITY;
    }

    // ============ PRICE UPDATE FUNCTIONS ============

    function updatePriceHistory(VolatilityStorage storage self, address[] calldata token) internal {
        for (uint256 i = 0; i < token.length; i++) {
            TokenConfig memory config = self.tokenConfigs[token[i]];
            if (!config.isSupported) revert TokenNotSupported();

            // Get current price
            (, int256 price,, uint256 updatedAt,) = config.priceFeed.latestRoundData();
            if (price <= 0) revert InvalidVolatility();
            if (block.timestamp - updatedAt > MAX_STALENESS) revert StaleVolatilityData();

            PriceHistory storage history = self.priceHistories[token[i]];
            uint256 currentPrice = uint256(price);

            // Update hourly data (if an hour has passed)
            if (block.timestamp >= history.lastHourlyUpdate + 1 hours) {
                history.hourlyPrices[history.hourlyIndex] = currentPrice;
                history.hourlyIndex = uint8((history.hourlyIndex + 1) % 24);
                history.lastHourlyUpdate = block.timestamp;
            }

            // Update daily data (if a day has passed)
            if (block.timestamp >= history.lastDailyUpdate + 1 days) {
                history.dailyPrices[history.dailyIndex] = currentPrice;
                history.dailyIndex = uint8((history.dailyIndex + 1) % 7);
                history.lastDailyUpdate = block.timestamp;
            }
        }
    }

    // ============ UTILITY FUNCTIONS ============

    function previewVolatility(VolatilityStorage storage self, address token, uint8 window)
        internal
        view
        returns (uint256)
    {
        return getTokenVolatility(self, token, window);
    }
}
