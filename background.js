importScripts('metadata-strategies.js');
importScripts('metadataProxy.js');

let isPlaying = false;
let isPaused = false;
let offscreenDocument = null;
let currentStation = null;
let favorites = [];
// contextMenuUpdateTimeout removed - using immediate updates for better responsiveness

// Enhanced state management
let audioSystemState = {
  lastKnownState: 'stopped', // stopped, playing, paused, buffering, error
  lastStateUpdate: Date.now(),
  connectionQuality: 'disconnected',
  forceResetInProgress: false,
  reconnectAttempts: 0
  // stateValidationInterval removed - using Chrome Alarms for dormancy resistance
};

// Now Playing metadata system
let currentMetadata = null;
let metadataFetchers = new Map();
// metadataUpdateInterval removed - using Chrome Alarms for dormancy resistance

// Smart metadata resource management
let popupVisibilityState = {
  isPopupOpen: false,
  lastPopupCloseTime: null,
  metadataPaused: false,
  lastKnownMetadata: null, // Preserve last metadata when paused
  pauseDelayMinutes: 3 // Pause metadata after 3 minutes of closed popup
};

chrome.runtime.onInstalled.addListener(() => {
  clearBadge();
  createContextMenus();
  loadCurrentStation();
  initializeStateManagement();
});

// Track popup visibility for smart metadata management
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    console.log('Popup connected - resuming metadata if needed');
    popupVisibilityState.isPopupOpen = true;
    popupVisibilityState.lastPopupCloseTime = null;

    // Resume metadata fetching if it was paused
    if (popupVisibilityState.metadataPaused && isPlaying && currentStation) {
      resumeMetadataFetching();
    }

    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected - starting metadata pause timer');
      popupVisibilityState.isPopupOpen = false;
      popupVisibilityState.lastPopupCloseTime = Date.now();

      // Set alarm to pause metadata after delay
      chrome.alarms.create('metadataPauseCheck', {
        delayInMinutes: popupVisibilityState.pauseDelayMinutes
      });
    });
  }
});

// Handle service worker startup (critical for dormancy recovery)
chrome.runtime.onStartup.addListener(async () => {
  console.log('Service worker starting up - restoring state...');
  await restoreStateFromStorage();
  clearBadge();
  createContextMenus();
  await loadCurrentStation();
  initializeStateManagement();

  // Resume stream monitoring if we were playing
  if (isPlaying && currentStation) {
    console.log('Resuming stream monitoring after startup...');
    await ensureOffscreenDocument();
    startStreamHealthMonitoringViaAlarms();
  }
});

// Persistent state management
async function saveStateToStorage() {
  try {
    await chrome.storage.local.set({
      'radiodock_persistent_state': {
        isPlaying,
        isPaused,
        currentStation,
        audioSystemState: {
          lastKnownState: audioSystemState.lastKnownState,
          lastStateUpdate: audioSystemState.lastStateUpdate,
          connectionQuality: audioSystemState.connectionQuality,
          reconnectAttempts: audioSystemState.reconnectAttempts
        },
        timestamp: Date.now()
      }
    });
  } catch (error) {
    console.error('Error saving state to storage:', error);
  }
}

async function restoreStateFromStorage() {
  try {
    const result = await chrome.storage.local.get('radiodock_persistent_state');
    const persistentState = result.radiodock_persistent_state;

    if (persistentState && (Date.now() - persistentState.timestamp) < 3600000) { // Within last hour
      console.log('Restoring persistent state:', persistentState);
      isPlaying = persistentState.isPlaying || false;
      isPaused = persistentState.isPaused || false;
      currentStation = persistentState.currentStation || null;

      if (persistentState.audioSystemState) {
        audioSystemState.lastKnownState = persistentState.audioSystemState.lastKnownState || 'stopped';
        audioSystemState.lastStateUpdate = persistentState.audioSystemState.lastStateUpdate || Date.now();
        audioSystemState.connectionQuality = persistentState.audioSystemState.connectionQuality || 'disconnected';
        audioSystemState.reconnectAttempts = persistentState.audioSystemState.reconnectAttempts || 0;
      }

      console.log('State restored successfully');
    } else {
      console.log('No recent persistent state found or state expired');
      isPlaying = false;
      isPaused = false;
    }
  } catch (error) {
    console.error('Error restoring state from storage:', error);
    isPlaying = false;
    isPaused = false;
  }
}

// Initialize enhanced state management
function initializeStateManagement() {
  // Start periodic state validation using alarms (dormancy-resistant)
  startStateValidationViaAlarms();

  console.log('State management initialized with dormancy-resistant alarms');
}

function startStateValidationViaAlarms() {
  // Create alarm for state validation (survives service worker dormancy)
  chrome.alarms.create('stateValidation', {
    delayInMinutes: 0.5, // ~30 seconds
    periodInMinutes: 0.5 // Repeat every ~30 seconds
  });

  console.log('State validation alarm created');
}

// Legacy function for compatibility
function startStateValidation() {
  startStateValidationViaAlarms();
}

function startStreamHealthMonitoringViaAlarms() {
  // Create alarm for stream monitoring coordination
  chrome.alarms.create('streamHealthCheck', {
    delayInMinutes: 0.083, // ~5 seconds
    periodInMinutes: 0.083 // Repeat every ~5 seconds
  });

  console.log('Stream health monitoring alarm created');
}

async function validateAudioState() {
  if (audioSystemState.forceResetInProgress) {
    return; // Skip validation during reset
  }

  // Initialize retry counter if not exists
  if (!audioSystemState.validationRetries) {
    audioSystemState.validationRetries = 0;
  }

  try {
    // Get current state from offscreen document with improved timeout handling
    const response = await sendToOffscreen({ type: 'GET_AUDIO_STATE' });

    if (response) {
      const actuallyPlaying = response.isPlaying;
      const stateAge = Date.now() - audioSystemState.lastStateUpdate;

      console.log(`State validation: background=${isPlaying}, offscreen=${actuallyPlaying}, age=${stateAge}ms, retries=${audioSystemState.validationRetries}`);

      // Reset retry counter on successful communication
      audioSystemState.validationRetries = 0;

      // Increased threshold from 5s to 15s and added stricter conditions
      const DESYNC_THRESHOLD = 15000; // 15 seconds

      // Check for state desync (popup thinks it's playing but audio is stopped)
      if (isPlaying && !actuallyPlaying && stateAge > DESYNC_THRESHOLD) {
        // Additional verification: check if this is a persistent issue
        if (audioSystemState.lastDesyncCheck &&
            (Date.now() - audioSystemState.lastDesyncCheck) < 60000) {
          // If we detected a similar issue recently, it might be persistent
          console.warn('Persistent state desync detected: isPlaying=true but audio not playing');
          handleStateDesync('Audio stopped but state shows playing');
        } else {
          // First detection - just log and set check time
          console.warn('Potential state desync detected - will recheck');
          audioSystemState.lastDesyncCheck = Date.now();
        }
      }

      // Check for stuck playback (opposite case - less critical, so restore immediately)
      if (!isPlaying && actuallyPlaying && stateAge > DESYNC_THRESHOLD) {
        console.warn('State desync detected: isPlaying=false but audio is playing - restoring state');
        // This case is less critical - restore the playing state immediately
        isPlaying = true;
        audioSystemState.lastKnownState = 'playing';
        audioSystemState.lastStateUpdate = Date.now();
        setPlayingBadge();
        updateContextMenus();
        saveStateToStorage();
      }

      // Update connection quality if available
      if (response.connectionQuality) {
        audioSystemState.connectionQuality = response.connectionQuality;
        audioSystemState.reconnectAttempts = response.reconnectAttempts || 0;
      }

      // Clear desync check if states are now consistent
      if ((isPlaying && actuallyPlaying) || (!isPlaying && !actuallyPlaying)) {
        if (audioSystemState.lastDesyncCheck) {
          console.log('State consistency restored');
          delete audioSystemState.lastDesyncCheck;
        }
      }
    }
  } catch (error) {
    console.log(`State validation communication failed (attempt ${audioSystemState.validationRetries + 1}/3):`, error.message);

    // Increment retry counter
    audioSystemState.validationRetries++;

    // Only trigger desync handling after multiple consecutive failures
    if (audioSystemState.validationRetries >= 3 && isPlaying) {
      console.error('Multiple state validation failures - possible audio system issue');
      handleStateDesync('Cannot communicate with audio system after multiple attempts');
      audioSystemState.validationRetries = 0; // Reset after handling
    }
    // For fewer than 3 failures, just log and continue - might be temporary network issue
  }
}

function handleStateDesync(reason) {
  console.warn('Handling state desync:', reason);

  // Reset internal state to match reality
  isPlaying = false;
  isPaused = false;
  audioSystemState.lastKnownState = 'stopped';
  audioSystemState.lastStateUpdate = Date.now();
  clearBadge();
  updateContextMenus();

  // Schedule a recovery check using alarm to survive service worker dormancy
  chrome.alarms.create('recoveryCheck', { delayInMinutes: 0.167 }); // ~10 seconds

  // Notify popup about the issue
  forwardToPopup({
    type: 'STATE_DESYNC_DETECTED',
    reason: reason,
    timestamp: Date.now()
  });
}

// handleNetworkChange function removed - network change detection not needed in current implementation

// Smart metadata resource management functions
function pauseMetadataFetching() {
  if (popupVisibilityState.metadataPaused) {
    return; // Already paused
  }

  popupVisibilityState.metadataPaused = true;

  // Preserve current metadata for when popup reopens
  if (currentMetadata) {
    popupVisibilityState.lastKnownMetadata = { ...currentMetadata };
  }

  // Clear metadata update alarm
  chrome.alarms.clear('metadataUpdate');

  // Stop all metadata fetchers but don't clear the map (keep for resuming)
  metadataFetchers.forEach((fetcher, url) => {
    try {
      if (fetcher && typeof fetcher.cleanup === 'function') {
        fetcher.cleanup();
      }
      if (fetcher && fetcher.abortController) {
        fetcher.abortController.abort();
      }
    } catch (error) {
      console.error(`Error cleaning up paused fetcher for ${url}:`, error);
    }
  });

  // Metadata fetching paused to save server resources
}

function resumeMetadataFetching() {
  if (!popupVisibilityState.metadataPaused) {
    return; // Not paused
  }

  popupVisibilityState.metadataPaused = false;

  // Restore last known metadata immediately for better UX
  if (popupVisibilityState.lastKnownMetadata) {
    currentMetadata = { ...popupVisibilityState.lastKnownMetadata };

    // Forward to popup immediately
    forwardToPopup({
      type: 'METADATA_UPDATE',
      metadata: currentMetadata,
      station: currentStation
    });
  }

  // Resume metadata fetching if we're playing
  if (isPlaying && currentStation) {
    startMetadataFetching(currentStation);
  }
}

async function forceResetAudioSystem() {
  console.log('Force resetting entire audio system...');
  audioSystemState.forceResetInProgress = true;
  
  try {
    // Stop all monitoring and metadata fetching
    stopMetadataFetching();
    
    // Reset internal state
    isPlaying = false;
    isPaused = false;
    audioSystemState.lastKnownState = 'stopped';
    audioSystemState.reconnectAttempts = 0;
    currentMetadata = null;
    
    // Destroy and recreate offscreen document
    try {
      if (offscreenDocument) {
        const contexts = await chrome.runtime.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        
        if (contexts.length > 0) {
          // Send force reset to offscreen first
          await sendToOffscreen({ type: 'FORCE_RESET_AUDIO' });
          
          // Wait a moment then close the offscreen document using alarm
          await new Promise(resolve => {
            chrome.alarms.create(`closeOffscreenDelay_${Date.now()}`, {
              delayInMinutes: 1 / 60 // 1 second
            });
            const listener = (alarm) => {
              if (alarm.name.startsWith('closeOffscreenDelay_')) {
                chrome.alarms.onAlarm.removeListener(listener);
                resolve();
              }
            };
            chrome.alarms.onAlarm.addListener(listener);
          });
          
          // Close offscreen document to completely reset it
          if (chrome.offscreen && chrome.offscreen.closeDocument) {
            await chrome.offscreen.closeDocument();
          }
        }
      }
    } catch (error) {
      console.warn('Error destroying offscreen document:', error);
    }
    
    // Clear offscreen reference
    offscreenDocument = null;
    
    // Update UI
    clearBadge();
    updateContextMenus();
    
    // Notify popup that reset is complete
    forwardToPopup({
      type: 'AUDIO_SYSTEM_RESET_COMPLETE',
      timestamp: Date.now()
    });
    
    console.log('Audio system force reset completed');
    
  } catch (error) {
    console.error('Error during force reset:', error);
  } finally {
    audioSystemState.forceResetInProgress = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  
  // Handle messages from popup (station control)
  if (message.type === 'PLAY_STATION' || message.type === 'PAUSE_STATION' || message.type === 'STOP_STATION' || message.type === 'SET_VOLUME' || message.type === 'FORCE_RESET_AUDIO_SYSTEM') {
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
      
      case 'FORCE_RESET_AUDIO_SYSTEM':
        forceResetAudioSystem();
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
      metadata: currentMetadata,
      connectionQuality: audioSystemState.connectionQuality,
      reconnectAttempts: audioSystemState.reconnectAttempts,
      lastStateUpdate: audioSystemState.lastStateUpdate
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
  // Handle messages from offscreen document (audio events and stream health)
  else if (message.type === 'AUDIO_PLAYING' || message.type === 'AUDIO_PAUSED' || 
           message.type === 'AUDIO_ENDED' || message.type === 'AUDIO_ERROR' || 
           message.type === 'HLS_METADATA' || message.type === 'STREAM_QUALITY_CHANGED' ||
           message.type === 'STREAM_HEALTH_CRITICAL' || message.type === 'STREAM_RECOVERY_ATTEMPTED' ||
           message.type === 'AUDIO_SYSTEM_RESET') {
    // Forward these messages to the popup if it's open
    forwardToPopup(message);
    
    // Update playing state based on audio events
    if (message.type === 'AUDIO_PLAYING') {
      // Only set playing if not deliberately paused
      if (!isPaused) {
        isPlaying = true;
        audioSystemState.lastKnownState = 'playing';
        audioSystemState.lastStateUpdate = Date.now();
        setPlayingBadge();
        updateContextMenus();
        // Start stream health monitoring
        startStreamHealthMonitoringViaAlarms();
        // Save state change
        saveStateToStorage();
      }
    } else if (message.type === 'AUDIO_PAUSED' || message.type === 'AUDIO_ENDED' || message.type === 'AUDIO_ERROR') {
      isPlaying = false;
      audioSystemState.lastKnownState = message.type === 'AUDIO_ERROR' ? 'error' : 'stopped';
      audioSystemState.lastStateUpdate = Date.now();
      clearBadge();
      updateContextMenus();
      // Stop health monitoring when not playing
      chrome.alarms.clear('streamHealthCheck');
      // Save state change
      saveStateToStorage();
    } else if (message.type === 'STREAM_QUALITY_CHANGED') {
      // Update connection quality tracking
      audioSystemState.connectionQuality = message.quality;
      audioSystemState.reconnectAttempts = message.attempts || 0;
    } else if (message.type === 'STREAM_HEALTH_CRITICAL') {
      // Handle critical stream health issues
      console.error('Stream health critical:', message.reason);
      audioSystemState.lastKnownState = 'error';
      audioSystemState.lastStateUpdate = Date.now();
    } else if (message.type === 'STREAM_RECOVERY_ATTEMPTED') {
      // Log recovery attempts
      console.log('Stream recovery attempted:', message.attempt);
      audioSystemState.reconnectAttempts = message.attempt;
    } else if (message.type === 'AUDIO_SYSTEM_RESET') {
      // Handle audio system reset from offscreen
      console.log('Audio system was reset by offscreen document');
      isPlaying = false;
      isPaused = false;
      audioSystemState.lastKnownState = 'stopped';
      audioSystemState.lastStateUpdate = Date.now();
      audioSystemState.reconnectAttempts = 0;
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

// Handle alarms for persistent monitoring (survives service worker dormancy)
chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    switch (alarm.name) {
      case 'stateValidation':
        await validateAudioState();
        // Save state periodically to maintain persistence
        await saveStateToStorage();
        break;

      case 'streamHealthCheck':
        // Coordinate with offscreen document for stream health monitoring
        if (isPlaying && currentStation) {
          await ensureOffscreenDocument();
          // Send message to offscreen to perform health check
          try {
            await sendToOffscreen({ type: 'PERFORM_HEALTH_CHECK' });
          } catch (error) {
            console.warn('Could not communicate with offscreen for health check:', error);
            // Try to recreate offscreen document if communication fails
            offscreenDocument = null;
            await ensureOffscreenDocument();
          }
        }
        break;

      case 'metadataUpdate':
        // Handle metadata updates via alarms instead of setInterval
        if (isPlaying && currentStation && !audioSystemState.forceResetInProgress && !popupVisibilityState.metadataPaused) {
          await fetchCurrentMetadata(currentStation);
        }
        break;

      case 'recoveryCheck':
        // Recovery check after state desync
        try {
          console.log('Performing recovery check after state desync...');
          const response = await sendToOffscreen({ type: 'GET_AUDIO_STATE' });

          if (response && response.isPlaying && currentStation) {
            console.log('Audio system recovered - restoring playing state');
            isPlaying = true;
            audioSystemState.lastKnownState = 'playing';
            audioSystemState.lastStateUpdate = Date.now();
            setPlayingBadge();
            updateContextMenus();
            saveStateToStorage();

            // Notify popup about recovery
            forwardToPopup({
              type: 'STATE_RECOVERY_DETECTED',
              reason: 'Audio system recovered after desync',
              timestamp: Date.now()
            });
          }
        } catch (error) {
          console.warn('Recovery check failed:', error.message);
        }
        break;

      default:
        // Handle metadata retry alarms
        if (alarm.name.startsWith('metadataRetry_')) {
          const parts = alarm.name.split('_');
          if (parts.length >= 2) {
            const stationUrl = parts.slice(1, -1).join('_'); // Reconstruct URL (may contain underscores)
            const station = currentStation && currentStation.url === stationUrl ? currentStation : null;

            if (station && metadataFetchers.has(station.url) && isPlaying) {
              const fetcher = metadataFetchers.get(station.url);
              const retryCount = (fetcher.retryCount || 0);
              // Reduced logging for production
              fetchCurrentMetadata(station, retryCount);
            }
          }
        }
        // Handle start metadata alarms
        else if (alarm.name.startsWith('startMetadata_')) {
          if (currentStation && isPlaying) {
            try {
              startMetadataFetching(currentStation);
            } catch (error) {
              console.error('Error starting metadata fetching:', error);
            }
          }
        }
        // Handle stream restart alarms
        else if (alarm.name.startsWith('restartStream_')) {
          if (currentStation && isPlaying) {
            try {
              await sendToOffscreen({
                type: 'PLAY_AUDIO',
                station: currentStation
              });
            } catch (error) {
              console.error('Error restarting audio after offscreen recreation:', error);
            }
          }
        }
        else if (alarm.name === 'metadataPauseCheck') {
          // Check if we should pause metadata fetching
          if (!popupVisibilityState.isPopupOpen &&
              popupVisibilityState.lastPopupCloseTime &&
              (Date.now() - popupVisibilityState.lastPopupCloseTime) >= (popupVisibilityState.pauseDelayMinutes * 60000)) {
            pauseMetadataFetching();
          }
        } else {
          // Silently ignore unknown alarms in production
        }
        break;
    }
  } catch (error) {
    console.error('Error handling alarm:', alarm.name, error);
  }
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
    
    // Start metadata fetching for this station using alarm for dormancy resistance
    chrome.alarms.create(`startMetadata_${Date.now()}`, {
      delayInMinutes: 2 / 60 // 2 seconds delay to let audio stabilize
    });
    
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
  const maxRetries = 2;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      // Check for existing contexts with timeout protection
      const contextCheckPromise = chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });

      // Add timeout protection for context check (can hang during service worker wake-up)
      const existingContexts = await Promise.race([
        contextCheckPromise,
        new Promise((_, reject) => {
          const timeoutAlarm = `contextTimeout_${Date.now()}`;
          chrome.alarms.create(timeoutAlarm, { delayInMinutes: 5 / 60 }); // 5 second timeout

          const timeoutListener = (alarm) => {
            if (alarm.name === timeoutAlarm) {
              chrome.alarms.onAlarm.removeListener(timeoutListener);
              reject(new Error('Context check timeout'));
            }
          };
          chrome.alarms.onAlarm.addListener(timeoutListener);
        })
      ]);

      if (existingContexts.length > 0) {
        offscreenDocument = true;
        console.log('Offscreen document already exists');
        return;
      }

      console.log(`Creating offscreen document (attempt ${retryCount + 1}/${maxRetries + 1})...`);
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play radio streams in background'
      });

      offscreenDocument = true;
      console.log('Offscreen document created successfully');

      // If we were playing, restart stream monitoring using alarm
      if (isPlaying && currentStation) {
        console.log('Scheduling stream restart after offscreen recreation...');
        chrome.alarms.create(`restartStream_${Date.now()}`, {
          delayInMinutes: 1 / 60 // 1 second delay
        });
      }

      return; // Success, exit retry loop

    } catch (error) {
      console.error(`Error ensuring offscreen document (attempt ${retryCount + 1}):`, error);
      retryCount++;
      offscreenDocument = false;

      if (retryCount <= maxRetries) {
        console.log(`Retrying offscreen document creation in ${retryCount * 1000}ms...`);

        // Use alarm for delay
        await new Promise(resolve => {
          const delayAlarm = `offscreenRetry_${Date.now()}`;
          chrome.alarms.create(delayAlarm, {
            delayInMinutes: retryCount / 60 // 1s, 2s delays
          });

          const delayListener = (alarm) => {
            if (alarm.name === delayAlarm) {
              chrome.alarms.onAlarm.removeListener(delayListener);
              resolve();
            }
          };
          chrome.alarms.onAlarm.addListener(delayListener);
        });
      }
    }
  }

  // If we get here, all retries failed
  throw new Error('Failed to create offscreen document after all retries');
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

// Send message to offscreen document with dormancy-aware retry logic
async function sendToOffscreen(message, retryCount = 0) {
  const maxRetries = 2;
  const baseTimeout = 5000; // Base timeout in milliseconds

  try {
    // Ensure offscreen document exists before sending messages
    await ensureOffscreenDocument();

    // Use runtime.sendMessage with timeout and retry logic
    return await new Promise((resolve, reject) => {
      let timeoutFired = false;
      const timeoutAlarmName = `msgTimeout_${Date.now()}`;

      // Set timeout using alarm for dormancy resistance
      chrome.alarms.create(timeoutAlarmName, {
        delayInMinutes: (baseTimeout + (retryCount * 2000)) / 60000
      });

      const timeoutListener = (alarm) => {
        if (alarm.name === timeoutAlarmName) {
          chrome.alarms.onAlarm.removeListener(timeoutListener);
          timeoutFired = true;
          reject(new Error(`Message timeout after ${baseTimeout + (retryCount * 2000)}ms`));
        }
      };
      chrome.alarms.onAlarm.addListener(timeoutListener);

      chrome.runtime.sendMessage(message, (response) => {
        // Clear timeout alarm
        chrome.alarms.clear(timeoutAlarmName);
        chrome.alarms.onAlarm.removeListener(timeoutListener);

        if (timeoutFired) {
          return; // Already rejected due to timeout
        }

        if (chrome.runtime.lastError) {
          // If communication fails, offscreen document might be dead or service worker was dormant
          const errorMessage = chrome.runtime.lastError.message;
          console.warn(`Communication with offscreen failed (attempt ${retryCount + 1}/${maxRetries + 1}):`, errorMessage);

          // Mark offscreen as potentially dead
          offscreenDocument = null;
          reject(new Error(errorMessage));
        } else {
          resolve(response);
        }
      });
    });
  } catch (error) {
    // Retry logic for dormancy scenarios
    if (retryCount < maxRetries) {
      console.log(`Retrying offscreen communication after ${(retryCount + 1) * 1000}ms delay...`);

      // Use alarm for delay instead of setTimeout for dormancy resistance
      await new Promise(resolve => {
        const alarmName = `commRetry_${Date.now()}`;
        chrome.alarms.create(alarmName, {
          delayInMinutes: (retryCount + 1) / 60 // 1s, 2s delays
        });

        const retryListener = (alarm) => {
          if (alarm.name === alarmName) {
            chrome.alarms.onAlarm.removeListener(retryListener);
            resolve();
          }
        };
        chrome.alarms.onAlarm.addListener(retryListener);
      });

      // Try to recreate offscreen document on retry
      try {
        offscreenDocument = null;
        await ensureOffscreenDocument();
      } catch (recreateError) {
        console.warn('Could not recreate offscreen document:', recreateError);
      }

      return sendToOffscreen(message, retryCount + 1);
    }

    console.error('Error sending message to offscreen after all retries:', error);
    throw error;
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

// Context menu update state to prevent race conditions
let contextMenuUpdateInProgress = false;

function updateContextMenus() {
  // Prevent race conditions during rapid updates
  if (contextMenuUpdateInProgress) {
    return;
  }

  contextMenuUpdateInProgress = true;

  // Immediate context menu update for better responsiveness and dormancy compatibility
  chrome.contextMenus.removeAll(() => {
    // Add error handling for context menu creation to prevent duplicate ID errors
    const createMenuItem = (options) => {
      try {
        chrome.contextMenus.create(options, () => {
          if (chrome.runtime.lastError) {
            // Silently ignore duplicate ID errors during rapid updates
            if (!chrome.runtime.lastError.message.includes('duplicate id')) {
              console.error('Error creating context menu item:', chrome.runtime.lastError.message);
            }
          }
        });
      } catch (error) {
        console.error('Exception creating context menu item:', error);
      }
    };

    // Create exactly 3 menu items always

    // 1. Play/Pause control
    if (isPlaying) {
      createMenuItem({
        id: 'pause-station',
        title: 'Pause Radio',
        contexts: ['action']
      });
    } else {
      if (currentStation) {
        createMenuItem({
          id: 'play-station',
          title: `Play ${currentStation.name}`,
          contexts: ['action']
        });
      } else {
        createMenuItem({
          id: 'play-station',
          title: 'Play Radio',
          contexts: ['action'],
          enabled: false
        });
      }
    }

    // 2. Next Station
    createMenuItem({
      id: 'next-station',
      title: 'Next Station',
      contexts: ['action'],
      enabled: favorites.length > 1
    });

    // 3. Previous Station
    createMenuItem({
      id: 'prev-station',
      title: 'Previous Station',
      contexts: ['action'],
      enabled: favorites.length > 1
    });

    // Reset flag after completion
    contextMenuUpdateInProgress = false;
  });
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
      let currentList = result.stationLists[result.currentListId];
      
      // If the current list is the community radios but not found in storage, load from JSON
      if (!currentList && result.currentListId === 'community-radios') {
        try {
          const response = await fetch(chrome.runtime.getURL('community-radios.json'));
          if (response.ok) {
            const communityData = await response.json();
            currentList = {
              id: 'community-radios',
              name: communityData.listName || 'Community Radios',
              stations: communityData.stations || [],
              isLinked: true,
              version: communityData.version
            };
          }
        } catch (error) {
          console.error('Error loading community radios in background:', error);
        }
      }
      
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

  // Check if metadata is paused (popup closed for extended period)
  if (popupVisibilityState.metadataPaused) {
    console.log('Metadata fetching is paused - popup closed, saving server resources');
    return;
  }

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

      // Use alarms instead of setInterval for metadata updates (survives service worker dormancy)
      chrome.alarms.create('metadataUpdate', {
        delayInMinutes: 0.33, // ~20 seconds
        periodInMinutes: 0.33 // Repeat every ~20 seconds
      });

      console.log('Metadata fetching alarm created for station:', station.name);

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
  // metadataUpdateInterval cleanup removed - using Chrome Alarms instead

  // Clear alarms for metadata updates
  chrome.alarms.clear('metadataUpdate');

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
      console.log('Cleaned up metadata fetcher for:', url);
    } catch (error) {
      console.error(`Error cleaning up fetcher for ${url}:`, error);
    }
  });

  metadataFetchers.clear();
  currentMetadata = null;

  // Reset pause state when stopping (not playing anymore)
  if (popupVisibilityState.metadataPaused) {
    popupVisibilityState.metadataPaused = false;
    popupVisibilityState.lastKnownMetadata = null;
  }

  console.log('Metadata fetching stopped and alarms cleared');
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
        if (!popupVisibilityState.metadataPaused && (!currentMetadata || (currentMetadata.nowPlaying !== 'Loading...' && currentMetadata.source !== 'Server Starting'))) {
          const loadingMetadata = {
            source: 'Loading',
            nowPlaying: 'Loading...',
            timestamp: Date.now()
          };
          currentMetadata = loadingMetadata;

          // Only update UI if popup is open (no need to waste cycles when closed)
          if (popupVisibilityState.isPopupOpen) {
            forwardToPopup({
              type: 'METADATA_UPDATE',
              metadata: loadingMetadata,
              station: station
            });
          }
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

      // Only forward to popup if it's open (save processing when closed)
      if (popupVisibilityState.isPopupOpen) {
        forwardToPopup({
          type: 'METADATA_UPDATE',
          metadata: metadata,
          station: station
        });
      } else if (!popupVisibilityState.metadataPaused) {
        // Store metadata for when popup opens, but don't send now
        popupVisibilityState.lastKnownMetadata = metadata;
      }
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
      

      // Schedule retry with exponential backoff using alarm for dormancy resistance
      chrome.alarms.create(`metadataRetry_${station.url}_${Date.now()}`, {
        delayInMinutes: retryDelay / 60000
      });
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
          headers: { 'User-Agent': 'RadioDock/1.1.1' },
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
        'User-Agent': 'RadioDock/1.1.1',
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
        'User-Agent': 'RadioDock/1.1.1'
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
        'User-Agent': 'RadioDock/1.1.1'
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
