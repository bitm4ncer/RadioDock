const audioPlayer = document.getElementById('audioPlayer');
let currentStation = null;
let isChangingStation = false;
let playPromise = null;
let hls = null;
let hlsLoaded = false;

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
    
    console.log('Loading HLS.js dynamically...');
    const script = document.createElement('script');
    script.src = 'hls.js';
    script.onload = () => {
      hlsLoaded = true;
      console.log('HLS.js loaded successfully');
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

audioPlayer.addEventListener('loadstart', () => {
  console.log('Audio loading started');
  notifyPopup('AUDIO_BUFFERING', { station: currentStation });
});

audioPlayer.addEventListener('waiting', () => {
  console.log('Audio is buffering');
  notifyPopup('AUDIO_BUFFERING', { station: currentStation });
});

audioPlayer.addEventListener('canplay', () => {
  console.log('Audio can start playing');
});

audioPlayer.addEventListener('canplaythrough', () => {
  console.log('Audio can play through without interruption');
  notifyPopup('AUDIO_PLAYING', { station: currentStation });
});

audioPlayer.addEventListener('play', () => {
  console.log('Audio play() called');
  // Don't notify here - wait for canplaythrough or playing event
});

audioPlayer.addEventListener('playing', () => {
  console.log('Audio is actually playing');
  notifyPopup('AUDIO_PLAYING', { station: currentStation });
});

audioPlayer.addEventListener('pause', () => {
  console.log('Audio paused');
  notifyPopup('AUDIO_PAUSED');
});

audioPlayer.addEventListener('ended', () => {
  console.log('Audio ended');
  notifyPopup('AUDIO_ENDED');
});

audioPlayer.addEventListener('error', (e) => {
  console.error('Audio error:', e);
  const error = audioPlayer.error;
  let errorMessage = 'Unknown audio error';
  
  if (error) {
    switch (error.code) {
      case error.MEDIA_ERR_ABORTED:
        errorMessage = 'Audio playback aborted';
        break;
      case error.MEDIA_ERR_NETWORK:
        errorMessage = 'Network error loading audio';
        break;
      case error.MEDIA_ERR_DECODE:
        errorMessage = 'Audio decode error';
        break;
      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        errorMessage = 'Audio format not supported';
        break;
    }
  }
  
  notifyPopup('AUDIO_ERROR', { error: errorMessage });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle audio-related messages in offscreen document
  const audioMessages = ['PLAY_AUDIO', 'PAUSE_AUDIO', 'STOP_AUDIO', 'GET_AUDIO_STATE', 'SET_VOLUME'];
  
  if (!audioMessages.includes(message.type)) {
    // Not for us, ignore silently
    return;
  }
  
  console.log('Offscreen received message:', message.type);
  
  switch (message.type) {
    case 'PLAY_AUDIO':
      playStation(message.station);
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
        duration: audioPlayer.duration
      });
      break;
    
    case 'SET_VOLUME':
      setVolume(message.volume);
      sendResponse({ success: true });
      break;
  }
  
  return true;
});

async function playStation(station) {
  if (!station || !station.url) {
    console.error('Invalid station data:', station);
    notifyPopup('AUDIO_ERROR', { error: 'Invalid station data' });
    return;
  }
  
  console.log('Playing station:', station.name, 'URL:', station.url);
  
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
        console.log('Previous play promise cancelled/failed/timed out, continuing...', e.message);
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
    
    // Check if this is an HLS stream
    const isHLS = station.url.includes('.m3u8') || station.url.includes('m3u8');
    
    if (isHLS) {
      try {
        // Load HLS.js dynamically only when needed
        await loadHLS();
        
        if (typeof Hls !== 'undefined' && Hls.isSupported()) {
          console.log('Using HLS.js for M3U8 stream');
          
          hls = new Hls({
            enableWorker: false,
            maxBufferLength: 10 // Reduce buffer for faster metadata
          });
        } else {
          console.log('HLS.js not supported, falling back to native HLS');
          // Try native HLS support (Safari)
          if (audioPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            audioPlayer.src = station.url;
            audioPlayer.crossOrigin = 'anonymous';
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
        console.log('HLS ID3 metadata received:', data);
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
            console.log('HLS failed, falling back to regular audio');
            try {
              audioPlayer.src = station.url;
              audioPlayer.crossOrigin = 'anonymous';
              audioPlayer.load();
            } catch (e) {
              console.error('Error in HLS fallback:', e);
              notifyPopup('AUDIO_ERROR', { error: 'HLS fallback failed' });
              isChangingStation = false;
              return;
            }
          }
        });
        
        hls.loadSource(station.url);
        hls.attachMedia(audioPlayer);
      }
    } else {
      // Use regular audio element for non-HLS streams
      try {
        audioPlayer.src = station.url;
        audioPlayer.crossOrigin = 'anonymous';
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
            console.log('Audio started playing successfully');
            isChangingStation = false;
            playPromise = null;
          }
        }).catch(error => {
          // Don't show error if we're in the middle of changing stations or promise was cancelled
          if (isChangingStation && (error.name === 'AbortError' || currentStation?.url !== station.url)) {
            console.log('Ignoring error during station change or after station switched');
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
          
          console.log('Audio error details:', { 
            name: error.name, 
            message: error.message, 
            code: error.code,
            stationUrl: station.url,
            currentStationUrl: currentStation?.url,
            isChangingStation: isChangingStation,
            willNotify: shouldNotify
          });
          
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
  
  if (!audioPlayer.paused) {
    audioPlayer.pause();
  }
}

function stopAudio() {
  isChangingStation = false;
  playPromise = null;
  
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
  console.log(`Audio volume set to ${Math.round(volume * 100)}%`);
}

function notifyPopup(type, data = {}) {
  try {
    chrome.runtime.sendMessage({
      type: type,
      ...data
    });
  } catch (error) {
    console.error('Error sending message to popup:', error);
  }
}