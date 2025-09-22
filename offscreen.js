const audioPlayer = document.getElementById('audioPlayer');
let currentStation = null;
let isChangingStation = false;
let playPromise = null;
let hls = null;
let hlsLoaded = false;

// Stream health monitoring system
let streamHealthMonitor = {
  isActive: false,
  heartbeatInterval: null,
  lastHeartbeat: null,
  connectionQuality: 'disconnected', // disconnected, poor, good, excellent
  silenceDetected: false,
  reconnectAttempts: 0,
  maxReconnectAttempts: 3, // Reduced from 5 to 3
  reconnectDelay: 2000, // Start with 2 seconds instead of 1
  maxReconnectDelay: 30000, // Max 30 seconds
  staleStreamTimeout: 60000, // Increased from 45 to 60 seconds
  audioContext: null,
  analyser: null,
  silenceThreshold: -60, // dB
  lastAudioLevel: 0,
  lastTimeUpdate: null,
  lastStateCheck: null, // Track when we last checked quality state
  poorQualityDuration: 0,
  consecutiveSilenceCount: 0,
  maxSilenceCount: 30, // Increased from 15 to 30 (60 seconds of silence)
  forceResetRequested: false
};


// Dynamically load HLS.js only when needed
async function loadHLS() {
  if (hlsLoaded) {
    return Promise.resolve();
  }
  
  return new Promise((resolve, reject) => {
    // Check if HLS is already available (in case it's been loaded by another script)
    if (typeof Hls !== 'undefined') {
      hlsLoaded = true;
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'hls.js';
    script.onload = () => {
      hlsLoaded = true;
      resolve();
    };
    script.onerror = () => {
      console.error('Failed to load HLS.js');
      reject(new Error('Failed to load HLS.js'));
    };
    
    // Add timeout for loading
    setTimeout(() => {
      if (!hlsLoaded) {
        document.head.removeChild(script);
        reject(new Error('HLS.js loading timeout'));
      }
    }, 5000);
    
    document.head.appendChild(script);
  });
}

// Handle playlist files (M3U/PLS) by fetching and parsing them via proxy
async function resolvePlaylist(url) {
  const PROXY_BASE_URL = 'https://radiodock-metadata-proxy-1.onrender.com';
  
  try {
    // Use the proxy server to fetch the playlist to avoid CORS issues
    const params = new URLSearchParams({
      action: 'fetch_playlist',
      url: url
    });
    
    const proxyUrl = `${PROXY_BASE_URL}/v1/playlist?${params.toString()}`;
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Proxy request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to resolve playlist');
    }
    
    if (!data.streamUrl) {
      throw new Error('No stream URL found in playlist response');
    }
    
    return data.streamUrl;
    
  } catch (error) {
    // If proxy fails, try direct fetch as fallback (will likely fail with CORS but worth trying)
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch playlist: ${response.status}`);
      }
      
      const text = await response.text();
      const lines = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      
      if (lines.length === 0) {
        throw new Error('No stream URLs found in playlist');
      }
      
      // Return the first valid URL found
      let streamUrl = lines[0];
      
      // If it's a relative URL, make it absolute
      if (streamUrl.startsWith('/') || !streamUrl.includes('://')) {
        const baseUrl = new URL(url);
        if (streamUrl.startsWith('/')) {
          streamUrl = `${baseUrl.protocol}//${baseUrl.host}${streamUrl}`;
        } else {
          streamUrl = `${baseUrl.protocol}//${baseUrl.host}/${streamUrl}`;
        }
      }
      
      return streamUrl;
    } catch (fallbackError) {
      throw new Error(`Playlist resolution failed: ${error.message}`);
    }
  }
}

// Stream Health Monitoring Functions
function initAudioContext() {
  try {
    // Skip audio context creation for now as it can interfere with playback
    // We'll use simpler monitoring methods instead
    console.log('Audio context monitoring disabled to prevent playback interference');
  } catch (error) {
    console.warn('Could not initialize audio context for monitoring:', error);
  }
}

function startStreamHealthMonitoring() {
  if (streamHealthMonitor.isActive) {
    stopStreamHealthMonitoring();
  }
  
  streamHealthMonitor.isActive = true;
  streamHealthMonitor.lastHeartbeat = Date.now();
  streamHealthMonitor.reconnectAttempts = 0;
  streamHealthMonitor.consecutiveSilenceCount = 0;
  streamHealthMonitor.forceResetRequested = false;
  
  // Initialize audio context for silence detection
  initAudioContext();
  
  // Start heartbeat monitoring - balanced frequency for good detection without interference
  streamHealthMonitor.heartbeatInterval = setInterval(() => {
    performHeartbeatCheck();
  }, 5000); // Check every 5 seconds for balanced detection
  
  updateConnectionQuality('good');
}

function stopStreamHealthMonitoring() {
  streamHealthMonitor.isActive = false;
  
  if (streamHealthMonitor.heartbeatInterval) {
    clearInterval(streamHealthMonitor.heartbeatInterval);
    streamHealthMonitor.heartbeatInterval = null;
  }
  
  streamHealthMonitor.reconnectAttempts = 0;
  streamHealthMonitor.consecutiveSilenceCount = 0;
  updateConnectionQuality('disconnected');
}

function performHeartbeatCheck() {
  if (!streamHealthMonitor.isActive || !currentStation || !audioPlayer) {
    return;
  }
  
  const now = Date.now();
  streamHealthMonitor.lastHeartbeat = now;
  
  // Check if audio element is in a valid state
  const isPlaying = !audioPlayer.paused && !audioPlayer.ended;
  const hasError = audioPlayer.error !== null;
  const readyState = audioPlayer.readyState;
  const networkState = audioPlayer.networkState;
  
  // Track how long we've been in problematic states
  if (!streamHealthMonitor.lastStateCheck) {
    streamHealthMonitor.lastStateCheck = now;
    streamHealthMonitor.poorQualityDuration = 0;
  }

  // Determine connection quality
  let quality = 'good';
  let needsRecovery = false;
  let shouldResetTimer = false;

  if (hasError) {
    quality = 'error';
    needsRecovery = audioPlayer.error.code !== audioPlayer.error.MEDIA_ERR_ABORTED;
  } else if (networkState === audioPlayer.NETWORK_NO_SOURCE || networkState === audioPlayer.NETWORK_EMPTY) {
    quality = 'error';
    needsRecovery = true;
  } else if (readyState < 2) {
    quality = 'poor';
    // Poor quality for more than 20 seconds needs recovery
    if (now - streamHealthMonitor.lastStateCheck > 20000) {
      needsRecovery = true;
    }
  } else if (readyState === 2) {
    quality = 'fair';
    // Fair quality (can start but not enough data) for more than 5 seconds needs recovery
    if (now - streamHealthMonitor.lastStateCheck > 5000) {
      needsRecovery = true;
    }
  } else if (readyState >= 3) {
    quality = isPlaying ? 'excellent' : 'good';
    // Only reset timer if we've been in good state for at least 2 seconds to prevent flapping
    if (streamHealthMonitor.connectionQuality !== 'excellent' && streamHealthMonitor.connectionQuality !== 'good') {
      shouldResetTimer = true;
    }
  }

  // Reset state check timer only when transitioning from bad to good state, not on every good check
  if (shouldResetTimer) {
    streamHealthMonitor.lastStateCheck = now;
  }
  
  // Special case: audio is "playing" but readyState dropped significantly
  if (isPlaying && readyState < 2 && now - streamHealthMonitor.lastStateCheck > 15000) {
    // Stream recovery system working correctly - reduced logging for production
    console.log('Stream readyState recovery triggered');
    needsRecovery = true;
    quality = 'error';
  }
  
  updateConnectionQuality(quality);
  
  // Trigger recovery if needed
  if (needsRecovery) {
    const reason = hasError ? `Audio error: ${audioPlayer.error.code}` :
                   readyState < 2 ? 'Stream stalled (low readyState)' :
                   'Stream quality degraded for too long';
    // Reduced logging for production - recovery is working correctly
    console.log('Stream recovery triggered:', reason);
    handleStreamIssue(reason);
  }
}

function detectAudioSilence() {
  // Simplified silence detection without audio context
  // For now, we'll rely on other indicators like readyState and currentTime progress
  return false; // Always assume audio is not silent to prevent false positives
}

function handleStreamIssue(reason) {
  if (!streamHealthMonitor.isActive || isChangingStation) {
    return;
  }

  // Reduced logging for production - recovery system is working correctly
  console.log('Stream recovery initiated:', reason);
  
  // Check if we've exceeded retry attempts
  if (streamHealthMonitor.reconnectAttempts >= streamHealthMonitor.maxReconnectAttempts) {
    console.error('Max reconnection attempts reached, giving up');
    notifyPopup('STREAM_HEALTH_CRITICAL', { 
      reason: 'Max retry attempts exceeded',
      attempts: streamHealthMonitor.reconnectAttempts 
    });
    stopStreamHealthMonitoring();
    return;
  }
  
  // Attempt automatic recovery
  streamHealthMonitor.reconnectAttempts++;

  // Faster initial recovery for "fair" status - use shorter delays
  let delay;
  if (streamHealthMonitor.reconnectAttempts === 1) {
    delay = 500; // First attempt: 500ms delay for immediate recovery
  } else {
    delay = Math.min(
      streamHealthMonitor.reconnectDelay * Math.pow(2, streamHealthMonitor.reconnectAttempts - 1),
      streamHealthMonitor.maxReconnectDelay
    );
  }

  console.log(`Attempting stream recovery (attempt ${streamHealthMonitor.reconnectAttempts}/${streamHealthMonitor.maxReconnectAttempts}) in ${delay}ms`);

  updateConnectionQuality('reconnecting');

  setTimeout(() => {
    if (streamHealthMonitor.isActive && currentStation && !isChangingStation) {
      attemptStreamReconnection();
    }
  }, delay);
}

function attemptStreamReconnection() {
  console.log('Attempting stream reconnection...');

  try {
    // Force cleanup current stream
    if (hls) {
      try {
        hls.destroy();
      } catch (e) {
        console.warn('Error destroying HLS during reconnection:', e);
      }
      hls = null;
    }

    // Reset audio element more efficiently for faster restart
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    audioPlayer.src = '';
    audioPlayer.load();

    // Reduced delay for faster recovery (250ms instead of 500ms)
    setTimeout(() => {
      if (streamHealthMonitor.isActive && currentStation && !isChangingStation) {
        console.log(`Fast recovery attempt ${streamHealthMonitor.reconnectAttempts} for ${currentStation.name}`);
        playStation(currentStation);
        notifyPopup('STREAM_RECOVERY_ATTEMPTED', {
          attempt: streamHealthMonitor.reconnectAttempts
        });
      }
    }, 250);

  } catch (error) {
    console.error('Error during stream reconnection:', error);
    handleStreamIssue('Reconnection failed: ' + error.message);
  }
}

function updateConnectionQuality(quality) {
  if (streamHealthMonitor.connectionQuality !== quality) {
    streamHealthMonitor.connectionQuality = quality;
    
    // Notify popup of quality change
    notifyPopup('STREAM_QUALITY_CHANGED', { 
      quality: quality,
      attempts: streamHealthMonitor.reconnectAttempts
    });
  }
}

function forceResetAudioSystem() {
  console.log('Force resetting audio system...');
  streamHealthMonitor.forceResetRequested = true;
  
  // Stop monitoring
  stopStreamHealthMonitoring();
  
  // Force cleanup everything
  if (hls) {
    try {
      hls.destroy();
    } catch (e) {
      console.warn('Error destroying HLS during force reset:', e);
    }
    hls = null;
  }
  
  // Reset audio context - be extra careful with cleanup
  if (streamHealthMonitor.audioContext) {
    try {
      if (streamHealthMonitor.audioContext.state !== 'closed') {
        streamHealthMonitor.audioContext.close();
      }
    } catch (e) {
      console.warn('Error closing audio context:', e);
    }
    streamHealthMonitor.audioContext = null;
    streamHealthMonitor.analyser = null;
  }
  
  // Reset audio element completely
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  audioPlayer.src = '';
  audioPlayer.load();
  
  // Clear all promises and state
  playPromise = null;
  isChangingStation = false;
  
  // Reset monitoring state
  streamHealthMonitor.reconnectAttempts = 0;
  streamHealthMonitor.consecutiveSilenceCount = 0;
  streamHealthMonitor.forceResetRequested = false;
  
  // Notify that reset is complete
  notifyPopup('AUDIO_SYSTEM_RESET');
}

audioPlayer.addEventListener('loadstart', () => {
  notifyPopup('AUDIO_BUFFERING', { station: currentStation });
});

audioPlayer.addEventListener('waiting', () => {
  notifyPopup('AUDIO_BUFFERING', { station: currentStation });
});

audioPlayer.addEventListener('canplay', () => {
});

audioPlayer.addEventListener('canplaythrough', () => {
  notifyPopup('AUDIO_PLAYING', { station: currentStation });
});

audioPlayer.addEventListener('play', () => {
  // Don't notify here - wait for canplaythrough or playing event
});

audioPlayer.addEventListener('playing', () => {
  notifyPopup('AUDIO_PLAYING', { station: currentStation });
});

audioPlayer.addEventListener('pause', () => {
  notifyPopup('AUDIO_PAUSED');
});

audioPlayer.addEventListener('ended', () => {
  notifyPopup('AUDIO_ENDED');
});

audioPlayer.addEventListener('error', (e) => {
  const error = audioPlayer.error;
  let errorMessage = 'Unknown audio error';
  let isCorsError = false;
  
  if (error) {
    switch (error.code) {
      case error.MEDIA_ERR_ABORTED:
        errorMessage = 'Audio playback aborted';
        break;
      case error.MEDIA_ERR_NETWORK:
        // Check if this might be a CORS error
        if (currentStation && currentStation.url) {
          const stationDomain = new URL(currentStation.url).hostname;
          if (!stationDomain.includes('radio-browser.info')) {
            isCorsError = true;
            errorMessage = `CORS error: ${currentStation.name || 'Station'} doesn't allow browser playback. Try a different stream or contact the station.`;
          } else {
            errorMessage = 'Network error loading audio';
          }
        } else {
          errorMessage = 'Network error loading audio';
        }
        break;
      case error.MEDIA_ERR_DECODE:
        errorMessage = 'Audio decode error';
        break;
      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        errorMessage = `Audio format not supported: ${currentStation?.url || 'unknown URL'}`;
        break;
    }
  }
  
  notifyPopup('AUDIO_ERROR', { 
    error: errorMessage, 
    isCorsError,
    station: currentStation?.name || 'Unknown'
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle audio-related messages in offscreen document
  const audioMessages = ['PLAY_AUDIO', 'PAUSE_AUDIO', 'STOP_AUDIO', 'GET_AUDIO_STATE', 'SET_VOLUME', 'FORCE_RESET_AUDIO', 'PERFORM_HEALTH_CHECK'];

  if (!audioMessages.includes(message.type)) {
    // Not for us, ignore silently
    return false; // Don't keep channel open for messages we don't handle
  }

  // Handle async operations properly
  const handleAsync = async () => {
    try {
      switch (message.type) {
        case 'PLAY_AUDIO':
          // Handle async playStation function properly
          await playStation(message.station);
          sendResponse({ success: true });
          break;

        case 'PAUSE_AUDIO':
          pauseAudio();
          sendResponse({ success: true });
          break;

        case 'STOP_AUDIO':
          stopAudio();
          sendResponse({ success: true });
          break;

        case 'GET_AUDIO_STATE':
          sendResponse({
            isPlaying: !audioPlayer.paused,
            currentStation: currentStation,
            currentTime: audioPlayer.currentTime,
            duration: audioPlayer.duration,
            connectionQuality: streamHealthMonitor.connectionQuality,
            reconnectAttempts: streamHealthMonitor.reconnectAttempts
          });
          break;

        case 'SET_VOLUME':
          setVolume(message.volume);
          sendResponse({ success: true });
          break;

        case 'FORCE_RESET_AUDIO':
          forceResetAudioSystem();
          sendResponse({ success: true });
          break;

        case 'PERFORM_HEALTH_CHECK':
          // Perform health check when requested by background script alarm
          if (streamHealthMonitor.isActive) {
            performHeartbeatCheck();
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
          break;
      }
    } catch (error) {
      console.error('Error handling message in offscreen:', error);
      // Try to send error response if channel is still open
      try {
        sendResponse({ success: false, error: error.message });
      } catch (responseError) {
        // Channel may be closed, ignore
        console.warn('Could not send error response, channel may be closed:', responseError);
      }
    }
  };

  // For PLAY_AUDIO, we need async handling
  if (message.type === 'PLAY_AUDIO') {
    handleAsync();
    return true; // Keep channel open for async response
  } else {
    // For all other messages, handle synchronously
    try {
      switch (message.type) {
        case 'PAUSE_AUDIO':
          pauseAudio();
          sendResponse({ success: true });
          break;

        case 'STOP_AUDIO':
          stopAudio();
          sendResponse({ success: true });
          break;

        case 'GET_AUDIO_STATE':
          sendResponse({
            isPlaying: !audioPlayer.paused,
            currentStation: currentStation,
            currentTime: audioPlayer.currentTime,
            duration: audioPlayer.duration,
            connectionQuality: streamHealthMonitor.connectionQuality,
            reconnectAttempts: streamHealthMonitor.reconnectAttempts
          });
          break;

        case 'SET_VOLUME':
          setVolume(message.volume);
          sendResponse({ success: true });
          break;

        case 'FORCE_RESET_AUDIO':
          forceResetAudioSystem();
          sendResponse({ success: true });
          break;

        case 'PERFORM_HEALTH_CHECK':
          if (streamHealthMonitor.isActive) {
            performHeartbeatCheck();
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
          break;
      }
    } catch (error) {
      console.error('Error handling message in offscreen:', error);
      try {
        sendResponse({ success: false, error: error.message });
      } catch (responseError) {
        console.warn('Could not send error response, channel may be closed:', responseError);
      }
    }
    return false; // Synchronous response for all other messages
  }
});

async function playStation(station) {
  if (!station || !station.url) {
    console.error('Invalid station data:', station);
    notifyPopup('AUDIO_ERROR', { error: 'Invalid station data' });
    return;
  }
  
  
  // Set flag to indicate we're changing stations
  isChangingStation = true;
  
  try {
    // Properly cancel any ongoing play promise to avoid conflicts
    if (playPromise && typeof playPromise.then === 'function') {
      try {
        // Create a timeout promise to avoid waiting too long
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Promise timeout')), 1000)
        );
        
        await Promise.race([playPromise, timeoutPromise]);
      } catch (e) {
        // Ignore errors from cancelled/timed out promises
      } finally {
        playPromise = null;
      }
    }
    
    // Cleanup previous HLS instance with proper error handling
    if (hls) {
      try {
        hls.destroy();
      } catch (e) {
        console.warn('Error destroying HLS instance:', e);
      } finally {
        hls = null;
      }
    }
    
    // Pause current audio before switching with safety check
    try {
      if (audioPlayer && !audioPlayer.paused) {
        audioPlayer.pause();
      }
    } catch (e) {
      console.warn('Error pausing audio:', e);
    }
    
    // Set new station
    currentStation = station;
    
    // Check if this is a playlist file that needs resolution
    const isM3U = station.url.includes('.m3u') && !station.url.includes('.m3u8');
    const isPLS = station.url.includes('.pls');
    
    // Handle playlist files (M3U/PLS) by resolving them first
    if (isM3U || isPLS) {
      try {
        const resolvedUrl = await resolvePlaylist(station.url);
        
        // Check if the resolved URL is problematic
        if (!resolvedUrl || resolvedUrl.length < 10) {
          throw new Error('Invalid resolved URL: ' + resolvedUrl);
        }
        
        // Update the station URL with the resolved stream URL
        currentStation = { ...station, url: resolvedUrl };
      } catch (error) {
        console.error('M3U playlist resolution failed:', error);
        notifyPopup('AUDIO_ERROR', { error: `Playlist error: ${error.message}` });
        isChangingStation = false;
        playPromise = null;
        return;
      }
    }
    
    // Check if this is an HLS stream (after possible M3U resolution)
    const isHLS = currentStation.url.includes('.m3u8') || currentStation.url.includes('m3u8');
    
    if (isHLS) {
      try {
        // Load HLS.js dynamically only when needed
        await loadHLS();
        
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          
          hls = new Hls({
            enableWorker: false,
            maxBufferLength: 10 // Reduce buffer for faster metadata
          });
        } else {
          // Try native HLS support (Safari)
          if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            audioPlayer.src = currentStation.url;
            audioPlayer.load();
          } else {
            throw new Error('HLS not supported');
          }
        }
      } catch (error) {
        console.error('Failed to load HLS.js:', error);
        notifyPopup('AUDIO_ERROR', { error: 'HLS playback not supported' });
        isChangingStation = false;
        playPromise = null;
        return;
      }
      
      // Setup HLS metadata listeners only if we have an HLS instance
      if (hls) {
        hls.on(Hls.Events.FRAG_PARSING_METADATA, (event, data) => {
        if (data.samples && data.samples.length > 0) {
          for (const sample of data.samples) {
            if (sample.data && sample.data.key) {
              const frames = sample.data;
              let title = null;
              let artist = null;
              
              // Extract TIT2 (title) and TPE1 (artist) frames
              for (const key in frames) {
                if (key === 'TIT2' && frames[key].data) {
                  title = frames[key].data;
                }
                if (key === 'TPE1' && frames[key].data) {
                  artist = frames[key].data;
                }
              }
              
              if (title || artist) {
                let nowPlaying = '';
                if (artist && title) {
                  nowPlaying = `${artist} - ${title}`;
                } else {
                  nowPlaying = title || artist;
                }
                
                // Send metadata to background script
                notifyPopup('HLS_METADATA', { 
                  nowPlaying: nowPlaying,
                  artist: artist,
                  title: title,
                  source: 'HLS ID3'
                });
              }
            }
          }
        }
        });
        
        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS error:', data);
          if (data.fatal) {
            // Fallback to regular audio element
            try {
              audioPlayer.src = currentStation.url;
              audioPlayer.load();
            } catch (e) {
              console.error('Error in HLS fallback:', e);
              notifyPopup('AUDIO_ERROR', { error: 'HLS fallback failed' });
              isChangingStation = false;
              return;
            }
          }
        });
        
        hls.loadSource(currentStation.url);
        hls.attachMedia(audioPlayer);
      }
    } else {
      // Use regular audio element for non-HLS streams
      try {
        audioPlayer.src = currentStation.url;
        audioPlayer.load();
      } catch (e) {
        console.error('Error loading audio source:', e);
        notifyPopup('AUDIO_ERROR', { error: 'Failed to load audio source' });
        isChangingStation = false;
        return;
      }
    }
    
    // Small delay to ensure audio element is ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Try to play the audio with improved promise handling
    try {
      playPromise = audioPlayer.play();
      
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise.then(() => {
          if (currentStation && currentStation.url === station.url) {
            isChangingStation = false;
            playPromise = null;
            // Start health monitoring when playback begins - wait longer for stream to stabilize
            setTimeout(() => {
              if (!audioPlayer.paused && currentStation && !isChangingStation) {
                startStreamHealthMonitoring();
              }
            }, 15000); // Wait 15 seconds for stream to fully stabilize
          }
        }).catch(error => {
          // Don't show error if we're in the middle of changing stations or promise was cancelled
          if (isChangingStation && (error.name === 'AbortError' || currentStation?.url !== station.url)) {
            return;
          }
          
          let errorMessage = 'Audio playback failed';
          let shouldNotify = true;
          
          if (error.name === 'NotAllowedError') {
            errorMessage = 'Click the extension icon to enable audio playback';
          } else if (error.name === 'NotSupportedError') {
            errorMessage = 'Audio format not supported by browser';
          } else if (error.name === 'AbortError') {
            errorMessage = 'Audio playback was interrupted';
            shouldNotify = false; // Don't notify for abort errors
          } else if (error.name === 'NetworkError') {
            errorMessage = 'Network error loading audio stream';
          } else if (error.message) {
            errorMessage = error.message;
          }
          
          
          if (shouldNotify) {
            notifyPopup('AUDIO_ERROR', { error: errorMessage });
          }
          isChangingStation = false;
          playPromise = null;
        });
      } else {
        isChangingStation = false;
        playPromise = null;
      }
    } catch (error) {
      console.error('Error calling play():', error);
      notifyPopup('AUDIO_ERROR', { error: 'Failed to start audio playback' });
      isChangingStation = false;
      playPromise = null;
    }
    
  } catch (error) {
    console.error('Error in playStation:', error);
    isChangingStation = false;
    playPromise = null;
    notifyPopup('AUDIO_ERROR', { error: 'Failed to switch station' });
  }
}

function pauseAudio() {
  isChangingStation = false;
  playPromise = null;
  
  // Stop health monitoring when paused
  stopStreamHealthMonitoring();
  
  if (!audioPlayer.paused) {
    audioPlayer.pause();
  }
}

function stopAudio() {
  isChangingStation = false;
  playPromise = null;
  
  // Stop health monitoring when stopped
  stopStreamHealthMonitoring();
  
  // Cleanup HLS instance
  if (hls) {
    hls.destroy();
    hls = null;
  }
  
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  currentStation = null;
}

function setVolume(volume) {
  audioPlayer.volume = volume;
}

function notifyPopup(type, data = {}) {
  try {
    chrome.runtime.sendMessage({
      type: type,
      ...data
    }, (response) => {
      // Handle response or check for errors
      if (chrome.runtime.lastError) {
        // Service worker may be dormant or popup closed, this is normal
        // Silently ignore common message channel errors during dormancy
        const ignoredErrors = [
          'Receiving end does not exist',
          'message channel closed',
          'asynchronous response'
        ];

        if (!ignoredErrors.some(err => chrome.runtime.lastError.message.includes(err))) {
          console.warn('Message send warning:', chrome.runtime.lastError.message);
        }
      }
    });
  } catch (error) {
    // Runtime error during send (e.g., extension context invalidated)
    console.error('Error sending message to popup:', error);
  }
}