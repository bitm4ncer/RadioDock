/**
 * Metadata Proxy Client for RadioDock Extension
 * 
 * Handles communication with the radiodock-metadata-proxy.onrender.com server
 * for all non-HLS metadata fetching. Routes HLS streams (.m3u8) to local
 * hls.js processing while sending all other streams to the proxy.
 * 
 * Maintains 1:1 compatibility with existing metadata display in the UI.
 */

// Proxy configuration
const PROXY_BASE_URL = 'https://radiodock-metadata-proxy-1.onrender.com';
const REQUEST_TIMEOUT = 15000; // 15 seconds - increased for cold starts
const MAX_RETRIES = 1;

/**
 * Fetch metadata from the proxy server
 * @param {Object} params - Parameters for metadata fetching
 * @param {string} params.streamUrl - Stream URL to fetch metadata for
 * @param {string} [params.stationId] - Station ID from Radio Browser
 * @param {string} [params.homepage] - Station homepage URL
 * @param {string} [params.country] - Station country code
 * @returns {Promise<Object>} Metadata response or null
 */
async function fetchNowPlaying({ streamUrl, stationId, homepage, country }) {
  if (!streamUrl || typeof streamUrl !== 'string') {
    console.error('Invalid stream URL provided to metadata proxy');
    return null;
  }

  // Check if this is an HLS stream - handle locally if so
  if (streamUrl.includes('.m3u8')) {
    return {
      source: 'hls-local',
      shouldUseLocal: true,
      reason: 'HLS streams handled by local hls.js'
    };
  }

  let lastError = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let controller = null;
    let timeoutId = null;
    
    try {
      controller = new AbortController();
      
      // Set up timeout with better error handling
      timeoutId = setTimeout(() => {
        if (controller && !controller.signal.aborted) {
          controller.abort();
        }
      }, REQUEST_TIMEOUT);
      
      // Build query parameters
      const params = new URLSearchParams({
        url: streamUrl
      });
      
      if (stationId) params.append('stationId', stationId);
      if (homepage) params.append('homepage', homepage);
      if (country) params.append('country', country);
      
      const url = `${PROXY_BASE_URL}/v1/metadata?${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'RadioDock/1.0',
          'Cache-Control': 'no-store'
        },
        signal: controller.signal
      });
      
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      if (!response.ok) {
        throw new Error(`Proxy server error: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Handle successful response
      if (data.ok) {
        return {
          source: mapProxySource(data.source),
          nowPlaying: data.display || '',
          artist: data.artist,
          title: data.title,
          raw: data.raw,
          timestamp: Date.now(),
          fromProxy: true,
          cacheTtl: data.cacheTtl || 15
        };
      } else {
        // Handle graceful errors from proxy
        if (data.reason === 'hls-client') {
          return {
            source: 'hls-local',
            shouldUseLocal: true,
            reason: 'HLS streams handled by local hls.js'
          };
        }
        
        // Log other proxy errors but don't retry for client-side issues
        if (['invalid-url', 'no-metadata', 'blocked'].includes(data.reason)) {
          return null;
        }
        
        // Retry for server-side errors
        if (attempt < MAX_RETRIES && ['timeout', 'upstream-error', 'server-error'].includes(data.reason)) {
          lastError = new Error(`Proxy error: ${data.message}`);
          await sleep(1000 * (attempt + 1)); // Exponential backoff
          continue;
        }
        
        console.error('Metadata proxy failed:', data.message);
        return null;
      }
      
    } catch (error) {
      lastError = error;
      
      // Clean up timeout if it exists
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      // Better error categorization with cold start detection
      if (error.name === 'AbortError') {
        // For timeouts, return loading indicator during cold start
        if (attempt === 0) {
          return {
            source: 'proxy-starting',
            nowPlaying: 'Loading...',
            isLoading: true,
            reason: 'Server starting up, please wait...'
          };
        }
      } else if (error.message.includes('NetworkError') || error.message.includes('fetch') || error.message.includes('Failed to fetch')) {
      } else if (error.message.includes('503') || error.message.includes('502') || error.message.includes('504')) {
        // Return loading indicator for server errors
        if (attempt === 0) {
          return {
            source: 'proxy-starting',
            nowPlaying: 'Loading...',
            isLoading: true,
            reason: 'Server starting up, please wait...'
          };
        }
      } else {
        console.error(`Metadata proxy request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, error.message);
      }
      
      // Retry on network errors and timeouts
      if (attempt < MAX_RETRIES) {
        await sleep(2000 * (attempt + 1)); // Longer backoff for server issues
        continue;
      }
    }
  }
  
  console.error(`Metadata proxy failed after ${MAX_RETRIES + 1} attempts:`, lastError?.message);
  return null;
}

/**
 * Map proxy source types to extension-compatible source names
 * @param {string} proxySource - Source type from proxy
 * @returns {string} Extension-compatible source name
 */
function mapProxySource(proxySource) {
  const sourceMap = {
    'nts': 'NTS Radio API',
    'airtimepro': 'Airtime Pro API',
    'cashmere': 'Cashmere Radio API',
    'icecast-status': 'Icecast Server',
    'icy': 'ICY Stream',
    'icy-headers': 'ICY Headers',
    'generic-api': 'Station API',
    'radioking': 'Radio King API',
    'callshop-radio': 'Callshop Radio JSON',
    'radio-browser': 'Radio-Browser API',
    'station-info': 'Station Info',
    'proxy-starting': 'Server Starting',
    'unknown': 'Metadata Server'
  };
  
  return sourceMap[proxySource] || 'Metadata Server';
}

/**
 * Sleep utility for retry delays
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if metadata proxy is available
 * @returns {Promise<boolean>} True if proxy is healthy
 */
async function isProxyHealthy() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // Shorter timeout for health check
    
    const response = await fetch(`${PROXY_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      return data.status === 'ok';
    }
    
    return false;
  } catch (error) {
    return false;
  }
}

/**
 * Enhanced fetch with graceful degradation
 * @param {Object} params - Parameters for metadata fetching
 * @returns {Promise<Object>} Metadata response or fallback indicator
 */
async function fetchNowPlayingWithFallback(params) {
  // Try proxy first
  const result = await fetchNowPlaying(params);
  
  if (result) {
    return result;
  }
  
  // If proxy fails, return fallback indicator
  return {
    source: 'proxy-unavailable',
    shouldUseFallback: true,
    reason: 'Proxy unavailable, use local fallback methods'
  };
}

/**
 * Validate that a stream URL should use the proxy
 * @param {string} streamUrl - Stream URL to validate
 * @returns {boolean} True if should use proxy, false if should handle locally
 */
function shouldUseProxy(streamUrl) {
  if (!streamUrl || typeof streamUrl !== 'string') {
    return false;
  }
  
  // HLS streams should be handled locally
  if (streamUrl.includes('.m3u8')) {
    return false;
  }
  
  // All other streams should use proxy
  return true;
}

// Expose functions globally for the service worker
self.fetchNowPlaying = fetchNowPlaying;
self.fetchNowPlayingWithFallback = fetchNowPlayingWithFallback;
self.isProxyHealthy = isProxyHealthy;
self.shouldUseProxy = shouldUseProxy;

// Also export for potential future module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fetchNowPlaying,
    fetchNowPlayingWithFallback,
    isProxyHealthy,
    shouldUseProxy,
    mapProxySource
  };
}