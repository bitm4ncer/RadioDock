importScripts('metadata-strategies.js');
importScripts('metadataProxy.js');

let isPlaying = false;
let isPaused = false;
let offscreenDocument = null;
let currentStation = null;
let favorites = [];
let contextMenuUpdateTimeout = null;

// Now Playing metadata system
let currentMetadata = null;
let metadataUpdateInterval = null;
let metadataFetchers = new Map();

chrome.runtime.onInstalled.addListener(() => {
  clearBadge();
  createContextMenus();
  loadCurrentStation();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Handle messages from popup (station control)
  if (message.type === 'PLAY_STATION' || message.type === 'PAUSE_STATION' || message.type === 'STOP_STATION' || message.type === 'SET_VOLUME') {
    switch (message.type) {
      case 'PLAY_STATION':
        // Update current station when playing
        currentStation = message.station;
        // Save to storage
        try {
          chrome.storage.sync.set({ currentStation: message.station });
        } catch (error) {
          console.error('Error saving current station to storage:', error);
        }
        handlePlayStation(message.station);
        sendResponse({ success: true });
        break;
      
      case 'PAUSE_STATION':
        handlePauseStation();
        sendResponse({ success: true });
        break;
      
      case 'STOP_STATION':
        handleStopStation();
        sendResponse({ success: true });
        break;
      
      case 'SET_VOLUME':
        handleSetVolume(message.volume);
        sendResponse({ success: true });
        break;
    }
  }
  // Handle other popup messages
  else if (message.type === 'GET_PLAYING_STATE') {
    sendResponse({ 
      isPlaying, 
      isPaused,
      currentStation: currentStation,
      metadata: currentMetadata
    });
  }
  else if (message.type === 'UPDATE_FAVORITES') {
    // Update favorites list when changed in popup
    favorites = message.favorites || [];
    updateContextMenus();
    sendResponse({ success: true });
  }
  else if (message.type === 'UPDATE_CURRENT_LIST') {
    // Update current list when changed in popup
    if (message.stationLists && message.currentListId) {
      const currentList = message.stationLists[message.currentListId];
      favorites = currentList ? currentList.stations : [];
      updateContextMenus();
    }
    sendResponse({ success: true });
  }
  // Handle messages from offscreen document (audio events)
  else if (message.type === 'AUDIO_PLAYING' || message.type === 'AUDIO_PAUSED' || 
           message.type === 'AUDIO_ENDED' || message.type === 'AUDIO_ERROR' || 
           message.type === 'HLS_METADATA') {
    // Forward these messages to the popup if it's open
    forwardToPopup(message);
    
    // Update playing state based on audio events
    if (message.type === 'AUDIO_PLAYING') {
      // Only set playing if not deliberately paused
      if (!isPaused) {
        isPlaying = true;
        setPlayingBadge();
        updateContextMenus();
      }
    } else if (message.type === 'AUDIO_PAUSED' || message.type === 'AUDIO_ENDED' || message.type === 'AUDIO_ERROR') {
      isPlaying = false;
      clearBadge();
      updateContextMenus();
    } else if (message.type === 'HLS_METADATA') {
      // Handle HLS metadata from offscreen audio player
      const cleanedNP = cleanNowPlaying(message.nowPlaying);
      if (cleanedNP && cleanedNP !== currentMetadata?.nowPlaying) {
        currentMetadata = {
          source: message.source || 'HLS ID3',
          nowPlaying: cleanedNP,
          artist: message.artist,
          title: message.title,
          timestamp: Date.now()
        };
        
        // Forward to popup
        forwardToPopup({
          type: 'METADATA_UPDATE',
          metadata: currentMetadata,
          station: currentStation
        });
      }
    }
  }
  
  return true;
});

async function handlePlayStation(station) {
  try {
    await ensureOffscreenDocument();
    
    // Clear pause state when starting to play
    isPaused = false;
    
    // Clear metadata immediately when switching stations
    currentMetadata = null;
    stopMetadataFetching();
    
    // Notify popup to clear metadata display
    forwardToPopup({
      type: 'METADATA_UPDATE',
      metadata: null,
      station: station
    });
    
    // Send message to offscreen document
    await sendToOffscreen({
      type: 'PLAY_AUDIO',
      station: station
    });
    
    // Start metadata fetching for this station (async, don't block)
    setTimeout(() => {
      try {
        startMetadataFetching(station);
      } catch (error) {
        console.error('Error starting metadata fetching:', error);
      }
    }, 2000); // Increased delay to let audio stabilize
    
    // Don't set isPlaying immediately - wait for AUDIO_PLAYING event
    
  } catch (error) {
    console.error('Error playing station:', error);
    isPlaying = false;
    isPaused = false;
    clearBadge();
    stopMetadataFetching();
  }
}

async function handlePauseStation() {
  if (offscreenDocument) {
    await sendToOffscreen({ type: 'PAUSE_AUDIO' });
  }
  
  // Set pause state to prevent audio events from overriding
  isPaused = true;
  isPlaying = false;
  clearBadge();
  updateContextMenus();
  
  // Clear metadata when pausing
  currentMetadata = null;
  stopMetadataFetching();
  
  // Notify popup to clear metadata display
  forwardToPopup({
    type: 'METADATA_UPDATE',
    metadata: null,
    station: currentStation
  });
}

async function handleStopStation() {
  if (offscreenDocument) {
    await sendToOffscreen({ type: 'STOP_AUDIO' });
  }
  
  // Clear both playing and pause state for stop
  isPaused = false;
  isPlaying = false;
  clearBadge();
  updateContextMenus();
  
  // Stop metadata fetching
  stopMetadataFetching();
}

async function handleSetVolume(volume) {
  if (offscreenDocument) {
    await sendToOffscreen({ type: 'SET_VOLUME', volume: volume });
  }
}

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('offscreen.html')]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play radio streams in background'
  });
  
  offscreenDocument = true;
}

function setPlayingBadge() {
  // Switch to red accent icons to indicate playing
  chrome.action.setIcon({
    path: {
      "16": "logo/icon-16-playing.png",
      "48": "logo/icon-48-playing.png", 
      "128": "logo/icon-128-playing.png"
    }
  });
}

function clearBadge() {
  // Switch back to normal icons when not playing
  chrome.action.setIcon({
    path: {
      "16": "logo/icon-16.png",
      "48": "logo/icon-48.png",
      "128": "logo/icon-128.png"
    }
  });
}

// Send message to offscreen document
async function sendToOffscreen(message) {
  try {
    // Use runtime.sendMessage - the offscreen document will filter for its messages
    chrome.runtime.sendMessage(message);
  } catch (error) {
    console.error('Error sending message to offscreen:', error);
  }
}

// Forward message to popup if it's open
async function forwardToPopup(message) {
  try {
      
    // Try to send message directly - popup will receive it if open
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        } else {
        }
    });
    
  } catch (error) {
    console.error('Error forwarding to popup:', error);
  }
}

// Context menu functionality
function createContextMenus() {
  // Remove existing context menus
  chrome.contextMenus.removeAll(() => {
    // Create initial context menu based on current state
    updateContextMenus();
  });
}

function updateContextMenus() {
  // Clear any pending updates to avoid race conditions
  if (contextMenuUpdateTimeout) {
    clearTimeout(contextMenuUpdateTimeout);
  }
  
  contextMenuUpdateTimeout = setTimeout(() => {
    chrome.contextMenus.removeAll(() => {
      // Create exactly 3 menu items always
      
      // 1. Play/Pause control
      if (isPlaying) {
        chrome.contextMenus.create({
          id: 'pause-station',
          title: 'Pause Radio',
          contexts: ['action']
        });
      } else {
        if (currentStation) {
          chrome.contextMenus.create({
            id: 'play-station',
            title: `Play ${currentStation.name}`,
            contexts: ['action']
          });
        } else {
          chrome.contextMenus.create({
            id: 'play-station',
            title: 'Play Radio',
            contexts: ['action'],
            enabled: false
          });
        }
      }
      
      // 2. Previous Station
      chrome.contextMenus.create({
        id: 'prev-station',
        title: 'Previous Station',
        contexts: ['action'],
        enabled: favorites.length > 1
      });
      
      // 3. Next Station
      chrome.contextMenus.create({
        id: 'next-station',
        title: 'Next Station',
        contexts: ['action'],
        enabled: favorites.length > 1
      });
    });
    contextMenuUpdateTimeout = null;
  }, 50);
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'play-station':
      if (currentStation) {
        await handlePlayStation(currentStation);
      }
      break;
      
    case 'pause-station':
      await handlePauseStation();
      break;
      
    case 'next-station':
      await playNextStation();
      break;
      
    case 'prev-station':
      await playPreviousStation();
      break;
  }
});

// Load current station and favorites from storage on startup
async function loadCurrentStation() {
  try {
    const result = await chrome.storage.sync.get(['currentStation', 'stationLists', 'currentListId', 'favorites']);
    currentStation = result.currentStation || null;
    
    // Handle new multiple lists structure
    if (result.stationLists && result.currentListId) {
      const currentList = result.stationLists[result.currentListId];
      favorites = currentList ? currentList.stations : [];
    }
    // Handle legacy favorites data
    else {
      favorites = result.favorites || [];
    }
    
    updateContextMenus();
  } catch (error) {
    console.error('Error loading current station:', error);
  }
}

// Navigate to next station in favorites
async function playNextStation() {
  if (favorites.length === 0) return;
  
  let nextIndex = 0;
  if (currentStation) {
    const currentIndex = favorites.findIndex(station => station.id === currentStation.id);
    nextIndex = currentIndex >= 0 ? (currentIndex + 1) % favorites.length : 0;
  }
  
  const nextStation = favorites[nextIndex];
  currentStation = nextStation;
  
  // Clear metadata immediately for station change
  currentMetadata = null;
  stopMetadataFetching();
  
  // Save the new current station to storage
  try {
    await chrome.storage.sync.set({ currentStation: nextStation });
  } catch (error) {
    console.error('Error saving current station to storage:', error);
  }
  
  // Notify popup about station change
  forwardToPopup({
    type: 'STATION_CHANGED',
    station: nextStation
  });
  
  await handlePlayStation(nextStation);
}

// Navigate to previous station in favorites
async function playPreviousStation() {
  if (favorites.length === 0) return;
  
  let prevIndex = 0;
  if (currentStation) {
    const currentIndex = favorites.findIndex(station => station.id === currentStation.id);
    prevIndex = currentIndex >= 0 ? (currentIndex - 1 + favorites.length) % favorites.length : favorites.length - 1;
  }
  
  const prevStation = favorites[prevIndex];
  currentStation = prevStation;
  
  // Clear metadata immediately for station change
  currentMetadata = null;
  stopMetadataFetching();
  
  // Save the new current station to storage
  try {
    await chrome.storage.sync.set({ currentStation: prevStation });
  } catch (error) {
    console.error('Error saving current station to storage:', error);
  }
  
  // Notify popup about station change
  forwardToPopup({
    type: 'STATION_CHANGED',
    station: prevStation
  });
  
  await handlePlayStation(prevStation);
}

// ========================
// NOW PLAYING METADATA SYSTEM
// ========================

// Start metadata fetching for current station
function startMetadataFetching(station) {
  if (!station || !station.url) return;
  
  stopMetadataFetching();
  
  try {
    // Determine the best metadata source for this station
    const fetcher = createMetadataFetcher(station);
    if (fetcher) {
      // Add station URL validation to prevent race conditions
      const stationUrl = station.url;
      metadataFetchers.set(stationUrl, {
        ...fetcher,
        stationUrl: stationUrl,
        startTime: Date.now()
      });
      
      // Start periodic updates with proper cleanup check
      metadataUpdateInterval = setInterval(async () => {
        try {
          // Verify we're still fetching for the same station to prevent race conditions
          if (isPlaying && currentStation && currentStation.url === stationUrl && 
              metadataFetchers.has(stationUrl)) {
            await fetchCurrentMetadata(station);
          } else {
            // Station changed, stop this interval
            if (metadataUpdateInterval) {
              clearInterval(metadataUpdateInterval);
              metadataUpdateInterval = null;
            }
          }
        } catch (error) {
          console.error('Error in metadata interval:', error);
          // On error, cleanup and stop interval to prevent resource leaks
          if (metadataUpdateInterval) {
            clearInterval(metadataUpdateInterval);
            metadataUpdateInterval = null;
          }
        }
      }, 20000); // Update every 20 seconds
      
      // Fetch immediately (but don't wait for it)
      fetchCurrentMetadata(station).catch(error => {
        console.error('Error in initial metadata fetch:', error);
      });
    }
  } catch (error) {
    console.error('Error starting metadata fetching:', error);
  }
}

// Stop metadata fetching
function stopMetadataFetching() {
  // Clear interval with safety check
  if (metadataUpdateInterval) {
    clearInterval(metadataUpdateInterval);
    metadataUpdateInterval = null;
  }
  
  // Properly cleanup all fetchers to prevent memory leaks
  metadataFetchers.forEach((fetcher, url) => {
    try {
      // Call cleanup function if available
      if (fetcher && typeof fetcher.cleanup === 'function') {
        fetcher.cleanup();
      }
      
      // Cleanup any active requests or timers associated with this fetcher
      if (fetcher && fetcher.abortController) {
        fetcher.abortController.abort();
      }
      
      // Log cleanup for debugging
    } catch (error) {
      console.error(`Error cleaning up fetcher for ${url}:`, error);
    }
  });
  
  metadataFetchers.clear();
  currentMetadata = null;
  
}

// Create appropriate metadata fetcher based on station
function createMetadataFetcher(station) {
  try {
    if (!station || !station.url) return null;
    
    const url = station.url;
    const name = station.name?.toLowerCase() || '';
    const homepage = station.homepage?.toLowerCase() || '';
    
    // NTS Radio - use their API
    if (name.includes('nts') || url.includes('nts.live')) {
      return { type: 'nts', url: 'https://www.nts.live/api/v2/live' };
    }

    // Cashmere Radio - special Airtime Pro endpoint
    // Detect by station name or homepage/stream URL containing cashmereradio
    if (name.includes('cashmere') || url.toLowerCase().includes('cashmereradio') || homepage.includes('cashmereradio')) {
      return { type: 'cashmere' };
    }

    // General Airtime Pro streams: *.out.airtime.pro -> use corresponding live-info API
    try {
      const urlObjForAirtime = new URL(url);
      const host = urlObjForAirtime.hostname || '';
      const m = host.match(/^([^.]+)\.out\.airtime\.pro$/i);
      if (m && m[1]) {
        const endpoint = `https://${m[1]}.airtime.pro/api/live-info-v2`;
        return { type: 'airtimepro', endpoint };
      }
    } catch (_) { /* ignore */ }
    
    // Try to extract Icecast server info from stream URL
    const urlObj = new URL(url);
  
  // Common Icecast status endpoints to try (avoid admin endpoints that require auth)
  const icecastEndpoints = [
    `${urlObj.protocol}//${urlObj.host}/status-json.xsl`,
    `${urlObj.protocol}//${urlObj.host}/status.json`,
    `${urlObj.protocol}//${urlObj.host}/stats.json`,
    `${urlObj.protocol}//${urlObj.host}/status?json=1`
  ];
  
    return {
      type: 'multi',
      sources: [
        { type: 'icecast', endpoints: icecastEndpoints, mount: urlObj.pathname },
        { type: 'radiobrowser', url: url, station: station },
        { type: 'hls', url: url },
        { type: 'icy', url: url },
        { type: 'generic', url: url, station: station }
      ]
    };
  } catch (error) {
    console.error('Error creating metadata fetcher:', error);
    return null;
  }
}

// Fetch metadata from appropriate source with retry logic
async function fetchCurrentMetadata(station, retryCount = 0) {
  const fetcher = metadataFetchers.get(station.url);
  if (!fetcher) return;
  
  const maxRetries = 2;
  const retryDelay = 1000 * (retryCount + 1); // Exponential backoff: 1s, 2s, 3s
  
  try {
    let metadata = null;
    
    // Check if this is an HLS stream - if so, continue using local processing
    const isHLSStream = station.url && station.url.includes('.m3u8');
    
    if (isHLSStream) {
      // HLS streams: use local hls.js processing (handled in offscreen.js)
      // For now, we'll use the existing local metadata strategies for HLS
      if (fetcher.type === 'multi') {
        metadata = await fetchFromSourcesFast(fetcher, station);
      }
    } else {
      // Non-HLS streams: use metadata proxy with fallback
      try {
        // Show loading state immediately for proxy requests (avoid duplicate loading states)
        if (!currentMetadata || (currentMetadata.nowPlaying !== 'Loading...' && currentMetadata.source !== 'Server Starting')) {
          const loadingMetadata = {
            source: 'Loading',
            nowPlaying: 'Loading...',
            timestamp: Date.now()
          };
          currentMetadata = loadingMetadata;
          setPlayingBadge();
          updateContextMenus();
        }
        
        metadata = await fetchNowPlayingWithFallback({
          streamUrl: station.url,
          stationId: station.id || station.stationuuid,
          homepage: station.homepage,
          country: station.countrycode || station.country
        });
        
        // Handle case where proxy indicates we should use local processing
        if (metadata && (metadata.shouldUseLocal || metadata.shouldUseFallback)) {
          if (fetcher.type === 'nts') {
            metadata = await fetchNTSMetadata(station);
          } else if (fetcher.type === 'cashmere') {
            metadata = await fetchCashmereMetadata(station);
          } else if (fetcher.type === 'airtimepro') {
            metadata = await fetchAirtimeProMetadata(station, fetcher.endpoint);
          } else if (fetcher.type === 'multi') {
            metadata = await fetchFromSourcesFast(fetcher, station);
          }
        }
        
        // Handle loading state response from proxy (server cold start)
        if (metadata && metadata.isLoading) {
          // Return the loading metadata to show to user
          return;
        }
      } catch (proxyError) {
        console.error('Metadata proxy failed completely, falling back to local methods:', proxyError.message || proxyError);
        // Fallback to local methods if proxy fails completely
        if (fetcher.type === 'nts') {
          metadata = await fetchNTSMetadata(station);
        } else if (fetcher.type === 'cashmere') {
          metadata = await fetchCashmereMetadata(station);
        } else if (fetcher.type === 'airtimepro') {
          metadata = await fetchAirtimeProMetadata(station, fetcher.endpoint);
        } else if (fetcher.type === 'multi') {
          metadata = await fetchFromSourcesFast(fetcher, station);
        }
      }
    }
    
    // Normalize leading dash issues seen on some stations
    if (metadata && metadata.nowPlaying) {
      const cleaned = cleanNowPlaying(metadata.nowPlaying);
      if (cleaned) {
        metadata.nowPlaying = cleaned;
      } else {
        // treat as no meaningful metadata
        metadata = null;
      }
    }

    // If no metadata found from any source (or cleaning removed it), show nothing instead of station name
    // Station name fallback disabled per user request - better to show nothing than redundant station name
    if (!metadata || !metadata.nowPlaying) {
      metadata = null; // Show nothing instead of falling back to station name
    }
    
    // Update metadata if changed (including null to clear loading state)
    if (JSON.stringify(metadata) !== JSON.stringify(currentMetadata)) {
      currentMetadata = metadata;
      
      // Reset retry count on success
      if (fetcher.retryCount) {
        fetcher.retryCount = 0;
      }
      
      // Update UI - badge should reflect playing state, not metadata presence
      if (isPlaying) {
        setPlayingBadge();
      } else {
        clearBadge();
      }
      updateContextMenus();
      
      // Forward to popup if open
      forwardToPopup({
        type: 'METADATA_UPDATE',
        metadata: metadata,
        station: station
      });
    }
    
  } catch (error) {
    console.error(`Error fetching metadata (attempt ${retryCount + 1}/${maxRetries + 1}):`, error);
    
    // Check if we should retry
    if (retryCount < maxRetries && 
        metadataFetchers.has(station.url) && 
        isPlaying && 
        currentStation && 
        currentStation.url === station.url) {
      
      // Update retry count in fetcher
      const currentFetcher = metadataFetchers.get(station.url);
      if (currentFetcher) {
        currentFetcher.retryCount = (currentFetcher.retryCount || 0) + 1;
      }
      
      
      // Schedule retry with exponential backoff
      setTimeout(() => {
        // Double-check that we still need to fetch metadata for this station
        if (metadataFetchers.has(station.url) && 
            isPlaying && 
            currentStation && 
            currentStation.url === station.url) {
          fetchCurrentMetadata(station, retryCount + 1);
        }
      }, retryDelay);
    } else {
      // Max retries reached or conditions changed
    }
  }
}

// Helper: return the first resolved metadata object with a nowPlaying value
function firstNonNullMetadata(promises) {
  return new Promise((resolve) => {
    let remaining = promises.length;
    let resolved = false;
    if (remaining === 0) return resolve(null);
    promises.forEach(p => {
      p.then(val => {
        if (!resolved && val && val.nowPlaying) {
          resolved = true;
          resolve(val);
        }
      }).catch(() => {}).finally(() => {
        remaining -= 1;
        if (!resolved && remaining === 0) {
          resolve(null);
        }
      });
    });
  });
}

// Run multi-source metadata fetches concurrently for faster first result
async function fetchFromSourcesFast(fetcher, station) {
  try {
    const url = station.url || '';
    const isHls = url.includes('.m3u8');
    const tasks = [];

    for (const source of fetcher.sources) {
      if (source.type === 'icecast') {
        tasks.push(fetchIcecastMetadata(source.endpoints, source.mount).catch(() => null));
      } else if (source.type === 'radiobrowser') {
        tasks.push(fetchRadioBrowserMetadata(source.station).catch(() => null));
      } else if (source.type === 'hls') {
        // Prioritize HLS if URL indicates HLS
        const task = fetchHLSMetadata(source.url).catch(() => null);
        if (isHls) {
          tasks.unshift(task);
          continue;
        }
        tasks.push(task);
      } else if (source.type === 'icy') {
        tasks.push(fetchICYMetadata(source.url).catch(() => null));
      } else if (source.type === 'generic') {
        tasks.push(fetchGenericMetadata(source.url, source.station).catch(() => null));
      }
    }

    const result = await firstNonNullMetadata(tasks);
    return result;
  } catch (e) {
    console.error('Error in concurrent metadata fetching:', e);
    return null;
  }
}

// fetchNTSMetadata, fetchCashmereMetadata, cleanNowPlaying are provided by metadata-strategies.js
// NOTE: The following metadata functions are now handled by the proxy server for non-HLS streams
// They remain here for HLS fallback compatibility and emergency fallback scenarios

// Icecast JSON status parsing with parallel endpoint support
async function fetchIcecastMetadata(endpoints, mount) {
  try {
    const attempt = async (statusUrl) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500); // faster 3.5s timeout per endpoint
      try {
        const response = await fetch(statusUrl, {
          cache: 'no-store',
          headers: { 'User-Agent': 'RadioDock/1.0' },
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
          if ([404, 401, 403, 500, 502, 503].includes(response.status)) return null;
          throw new Error(`Icecast status error: ${response.status}`);
        }
        const data = await response.json();

        // Handle different JSON structures
        let sources = [];
        if (data.icestats?.source) {
          sources = Array.isArray(data.icestats.source) ? data.icestats.source : [data.icestats.source];
        } else if (data.sources) {
          sources = Array.isArray(data.sources) ? data.sources : [data.sources];
        } else if (data.source) {
          sources = Array.isArray(data.source) ? data.source : [data.source];
        } else if (data.stats) {
          sources = [data.stats];
        }

        let source = sources.find(s =>
          s.listenurl?.includes(mount) || s.mount?.includes(mount) || s.path?.includes(mount)
        ) || sources[0];

        if (source && (source.title || source.artist || source.song || source.track || source.track_title || source.artist_name)) {
          const title = source.title || source.song || source.track || source.track_title || '';
          const artist = source.artist || source.performer || source.artist_name || '';

          let parsedArtist = artist;
          let parsedTitle = title;
          if (!artist && title.includes(' - ')) {
            const parts = title.split(' - ');
            parsedArtist = parts[0].trim();
            parsedTitle = parts.slice(1).join(' - ').trim();
          }

          let nowPlaying = '';
          if (parsedArtist && parsedTitle && parsedArtist !== parsedTitle) nowPlaying = `${parsedArtist} - ${parsedTitle}`;
          else if (parsedTitle) nowPlaying = parsedTitle;
          else if (parsedArtist) nowPlaying = parsedArtist;

          if (nowPlaying && nowPlaying.length > 3) {
            const filtered = nowPlaying.toLowerCase();
            const unwantedPatterns = ['unknown', 'untitled', 'live', 'on-air', 'stream', 'radio'];
            const isGeneric = unwantedPatterns.some(pattern =>
              filtered === pattern || (filtered.length < 15 && filtered.includes(pattern))
            );
            if (!isGeneric) {
              return {
                source: 'Icecast Server',
                nowPlaying: nowPlaying,
                genre: source.genre,
                bitrate: source.bitrate,
                listeners: source.listeners || source.listener_peak,
                endpoint: statusUrl,
                timestamp: Date.now()
              };
            }
          }
        }
        return null;
      } catch (error) {
        if (error.name === 'AbortError') return null;
        if (typeof error.message === 'string' && (
          error.message.includes('404') || error.message.includes('401') || error.message.includes('403') || error.message.includes('500')
        )) return null;
        // Log once per endpoint attempt
        return null;
      }
    };

    const promises = endpoints.map(e => attempt(e));
    return await firstNonNullMetadata(promises) || null;
  } catch (e) {
    return null;
  }
}

// ICY metadata parsing with actual stream data extraction (reduced timeout)
async function fetchICYMetadata(streamUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // faster 8s timeout
    
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'Icy-MetaData': '1',
        'User-Agent': 'RadioDock/1.0',
        'Range': 'bytes=0-8192' // Only fetch first 8KB to find metadata
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`ICY fetch error: ${response.status}`);
    
    const icyMetaInt = parseInt(response.headers.get('icy-metaint'));
    if (!icyMetaInt || !response.body) {
      // Fallback to headers if no metadata blocks
      const icyName = response.headers.get('icy-name');
      const icyDescription = response.headers.get('icy-description');
      
      if (icyName && icyName !== icyDescription) {
        return {
          source: 'ICY Headers',
          nowPlaying: icyName,
          genre: response.headers.get('icy-genre'),
          timestamp: Date.now()
        };
      }
      throw new Error('No ICY metadata available');
    }
    
    // Read the stream to extract metadata blocks
    const reader = response.body.getReader();
    let buffer = new Uint8Array();
    let bytesRead = 0;
    let metadataFound = null;
    
    while (bytesRead < icyMetaInt + 255 && !metadataFound) {
      const { done, value } = await reader.read();
      if (done) break;
      
      // Append new data to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
      bytesRead += value.length;
      
      // Check if we have reached the metadata block
      if (buffer.length >= icyMetaInt + 1) {
        const metadataLength = buffer[icyMetaInt] * 16;
        
        if (metadataLength > 0 && buffer.length >= icyMetaInt + 1 + metadataLength) {
          // Extract metadata block
          const metadataBytes = buffer.slice(icyMetaInt + 1, icyMetaInt + 1 + metadataLength);
          const metadataString = new TextDecoder().decode(metadataBytes).replace(/\0/g, '');
          
          // Parse multiple metadata fields from ICY metadata
          const streamTitleMatch = metadataString.match(/StreamTitle='([^']*)'/);
          const streamArtistMatch = metadataString.match(/StreamArtist='([^']*)'/);
          const streamUrlMatch = metadataString.match(/StreamUrl='([^']*)'/);
          
          let artist = streamArtistMatch ? streamArtistMatch[1].trim() : '';
          let title = streamTitleMatch ? streamTitleMatch[1].trim() : '';
          
          // Combine artist and title if both exist
          if (artist && title && artist !== title) {
            metadataFound = `${artist} - ${title}`;
          } else if (title) {
            metadataFound = title;
          } else if (artist) {
            metadataFound = artist;
          }
        }
      }
    }
    
    reader.cancel();
    
    // Filter out generic/unhelpful metadata
    if (metadataFound && metadataFound.length > 0) {
      const filtered = metadataFound.toLowerCase();
      const unwantedPatterns = [
        'unknown', 'airtime!', 'live', 'on-air', 'radio', 'stream',
        'broadcasting', 'music', 'live stream', 'internet radio',
        'online radio', 'web radio', 'digital radio'
      ];
      
      const isGeneric = unwantedPatterns.some(pattern => 
        filtered === pattern || 
        (filtered.length < 20 && filtered.includes(pattern))
      );
      
      if (!isGeneric && metadataFound.length > 3) {
        return {
          source: 'ICY Stream',
          nowPlaying: metadataFound,
          timestamp: Date.now()
        };
      }
    }
    
    return null;
  } catch (error) {
    // Only log significant errors, not common network issues or expected server errors
    const isCommonError = error.name === 'AbortError' || 
                         error.message.includes('NetworkError') || 
                         error.message.includes('No ICY metadata available') ||
                         error.message.includes('ICY fetch error:'); // All HTTP status errors
    
    if (!isCommonError) {
      console.error('ICY metadata fetch failed:', error);
    }
    return null;
  }
}

// Generic metadata fetcher for unknown stream types (refactored to use shared utilities)
async function fetchGenericMetadata(streamUrl, station) {
  try {
    const urlObj = new URL(streamUrl);
    
    // Special handling for Callshop Radio - use their JSON status endpoint
    if (streamUrl.includes('callshopradio.com')) {
      try {
        const response = await fetchWithTimeout('https://icecast.callshopradio.com/status-json.xsl', {
          cache: 'no-store'
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Extract sources from the JSON response
          let sources = [];
          if (data.icestats?.source) {
            sources = Array.isArray(data.icestats.source) ? data.icestats.source : [data.icestats.source];
          }
          
          // Look for the callshopradio mount or use the first source
          const mount = streamUrl.includes('/callshopradio-wien') ? '/callshopradio-wien' : '/callshopradio';
          let source = sources.find(s => s.listenurl?.includes(mount) || s.mount?.includes(mount)) || sources[0];
          
          if (source?.title && source.title.trim() && source.title !== '') {
            const metadata = {
              source: 'Callshop Radio JSON',
              nowPlaying: source.title.trim(),
              genre: source.genre,
              listeners: source.listeners,
              timestamp: Date.now()
            };
            
            return isValidMetadata(metadata) ? metadata : null;
          }
        }
      } catch (e) {
        // Continue to other methods if this fails
      }
    }
    
    // Special handling for Radio King streams
    if (streamUrl.includes('radioking.com')) {
      const radioIdMatch = streamUrl.match(/radio\/(\d+)/);
      if (radioIdMatch) {
        const radioId = radioIdMatch[1];
        const radioKingEndpoints = [
          `https://www.radioking.com/api/radio/${radioId}/track/current`,
          `https://api.radioking.com/widget/radio/${radioId}`,
          `https://www.radioking.com/api/radio/${radioId}`,
          `${urlObj.protocol}//${urlObj.host}/api/radio/${radioId}/track/current`
        ];
        
        for (const endpoint of radioKingEndpoints) {
          try {
            const response = await fetchWithTimeout(endpoint, { cache: 'no-store' }, 3000);
            
            if (response.ok) {
              const data = await response.json();
              const parsed = parseArtistTitle(
                data.title || data.track?.title || data.track?.name || '',
                data.artist || data.track?.artist || '',
                data.title || data.track?.title || data.track?.name || ''
              );
              
              if (parsed) {
                const metadata = {
                  source: 'Radio King API',
                  nowPlaying: parsed.nowPlaying,
                  timestamp: Date.now()
                };
                
                return isValidMetadata(metadata) ? metadata : null;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }
    }
    
    // Try common metadata endpoints based on station URL
    const metadataEndpoints = [
      `${urlObj.protocol}//${urlObj.host}/api/nowplaying`,
      `${urlObj.protocol}//${urlObj.host}/nowplaying`,
      `${urlObj.protocol}//${urlObj.host}/current`,
      `${urlObj.protocol}//${urlObj.host}/metadata`,
      `${urlObj.protocol}//${urlObj.host}/info`,
      `${urlObj.protocol}//${urlObj.host}/playing.json`,
      `${urlObj.protocol}//${urlObj.host}/current.json`,
      `${urlObj.protocol}//${urlObj.host}/api/current`,
      `${urlObj.protocol}//${urlObj.host}/stats`,
      `${urlObj.protocol}//${urlObj.host}/7.html` // Some Icecast servers use this
    ];
    
    for (const endpoint of metadataEndpoints) {
      try {
        const response = await fetchWithTimeout(endpoint, { cache: 'no-store' }, 3000);
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const parsed = parseStationMetadata(data);
        
        if (parsed) {
          const metadata = {
            source: 'Station API',
            nowPlaying: parsed.nowPlaying,
            endpoint: endpoint,
            timestamp: Date.now()
          };
          
          if (isValidMetadata(metadata)) {
            return metadata;
          }
        }
      } catch (error) {
        // Silently continue to next endpoint
        continue;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// HLS metadata extraction for M3U8 streams
async function fetchHLSMetadata(streamUrl) {
  try {
    // Check if it's an HLS stream
    if (!streamUrl.includes('.m3u8')) {
      return null;
    }
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
    
    const response = await fetch(streamUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'RadioDock/1.0'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HLS fetch error: ${response.status}`);
    
    const playlistText = await response.text();
    
    // Look for EXT-X-STREAM-INF or other metadata tags
    const lines = playlistText.split('\n');
    let nowPlaying = null;
    
    for (let line of lines) {
      line = line.trim();
      
      // Look for ID3 tags or metadata comments
      if (line.startsWith('#EXT-X-DATERANGE:') && line.includes('TITLE=')) {
        const titleMatch = line.match(/TITLE="([^"]+)"/);
        if (titleMatch) {
          nowPlaying = titleMatch[1];
          break;
        }
      }
      
      // Look for stream information
      if (line.startsWith('#EXT-X-STREAM-INF:') && line.includes('NAME=')) {
        const nameMatch = line.match(/NAME="([^"]+)"/);
        if (nameMatch) {
          nowPlaying = nameMatch[1];
        }
      }
    }
    
    if (nowPlaying) {
      return {
        source: 'HLS Stream',
        nowPlaying: nowPlaying,
        timestamp: Date.now()
      };
    }
    
    return null;
  } catch (error) {
    console.error('HLS metadata fetch failed:', error);
    return null;
  }
}

// Radio-Browser API metadata (using last known station info)
async function fetchRadioBrowserMetadata(station) {
  try {
    if (!station.id) return null;
    
    const response = await fetch(`https://de1.api.radio-browser.info/json/stations/byuuid/${station.id}`, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'RadioDock/1.0'
      }
    });
    
    if (!response.ok) throw new Error(`Radio-Browser API error: ${response.status}`);
    
    const stations = await response.json();
    const stationInfo = stations[0];
    
    if (stationInfo) {
      // Check for any recently updated info that might indicate current content
      const lastChanged = new Date(stationInfo.lastchangetime_iso8601);
      const isRecent = (Date.now() - lastChanged.getTime()) < 3600000; // Within last hour
      
      if (isRecent && stationInfo.lastcheckok === 1) {
        // Station is recently active, might have current info
        let nowPlaying = null;
        
        // Sometimes stations update their name to include current show/track
        if (stationInfo.name !== station.name && 
            stationInfo.name.length > station.name.length) {
          nowPlaying = stationInfo.name;
        }
        
        if (nowPlaying) {
          return {
            source: 'Radio-Browser API',
            nowPlaying: nowPlaying,
            timestamp: Date.now()
          };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Radio-Browser metadata fetch failed:', error);
    return null;
  }
}

// Robust fallback system - disabled per user request to show nothing instead of station name
async function fetchFallbackMetadata(station) {
  try {
    // Station name fallback disabled - better to show nothing than redundant station name
    // Previously returned station name as last resort, now returns null
    return null;
  } catch (error) {
    console.error('Fallback metadata fetch failed:', error);
    return null;
  }
}
