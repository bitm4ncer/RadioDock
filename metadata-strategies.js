// Shared normalization for now playing strings
function cleanNowPlaying(text) {
  try {
    if (!text) return '';
    let s = String(text).trim();
    
    // Decode HTML entities
    s = s.replace(/&amp;/g, '&')
         .replace(/&lt;/g, '<')
         .replace(/&gt;/g, '>')
         .replace(/&quot;/g, '"')
         .replace(/&#039;/g, "'")
         .replace(/&#x27;/g, "'")
         .replace(/&#0*39;/g, "'");
    
    // Remove a leading dash variant like "- ", "– ", "— " (with optional leading spaces)
    s = s.replace(/^\s*[-–—]\s+/, '');
    return s.trim();
  } catch (e) {
    return typeof text === 'string' ? text.trim() : '';
  }
}

// Shared HTTP request utility with timeout and abort controller
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'RadioDock/1.0',
        ...options.headers
      }
    });
    
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Common metadata validation and filtering
function isValidMetadata(metadata) {
  if (!metadata || !metadata.nowPlaying || typeof metadata.nowPlaying !== 'string') {
    return false;
  }
  
  const text = metadata.nowPlaying.toLowerCase().trim();
  if (text.length < 3) return false;
  
  // Filter out common generic/unhelpful metadata
  const unwantedPatterns = [
    'unknown', 'untitled', 'live', 'on-air', 'stream', 'radio',
    'broadcasting', 'music', 'live stream', 'internet radio',
    'online radio', 'web radio', 'digital radio', 'airtime!'
  ];
  
  const isGeneric = unwantedPatterns.some(pattern => 
    text === pattern || (text.length < 20 && text.includes(pattern))
  );
  
  return !isGeneric;
}

// Parse artist and title from various formats
function parseArtistTitle(text, artist = '', title = '') {
  if (!text && !artist && !title) return null;
  
  let finalArtist = artist;
  let finalTitle = title;
  
  // If we have text but no separate artist/title, try to parse from text
  if (text && !artist && !title && text.includes(' - ')) {
    const parts = text.split(' - ');
    finalArtist = parts[0].trim();
    finalTitle = parts.slice(1).join(' - ').trim();
  } else if (text && (!artist || !title)) {
    // Use text as fallback
    finalTitle = text;
  }
  
  // Build final now playing string
  let nowPlaying = '';
  if (finalArtist && finalTitle && finalArtist !== finalTitle) {
    nowPlaying = `${finalArtist} - ${finalTitle}`;
  } else if (finalTitle) {
    nowPlaying = finalTitle;
  } else if (finalArtist) {
    nowPlaying = finalArtist;
  } else if (text) {
    nowPlaying = text;
  }
  
  return nowPlaying ? { nowPlaying: cleanNowPlaying(nowPlaying) } : null;
}

// Common JSON parsing for various station API formats
function parseStationMetadata(data) {
  if (!data || typeof data !== 'object') return null;
  
  let artist = '';
  let title = '';
  let nowPlaying = '';
  
  // Try different common API formats
  if (data.nowplaying || data.now_playing) {
    const np = data.nowplaying || data.now_playing;
    if (typeof np === 'string') {
      nowPlaying = np;
    } else if (np && typeof np === 'object') {
      artist = np.artist || np.performer || '';
      title = np.song || np.track || np.title || '';
    }
  } else if (data.current) {
    const current = data.current;
    if (typeof current === 'string') {
      nowPlaying = current;
    } else if (current && typeof current === 'object') {
      title = current.title || current.track || '';
    }
  } else if (data.song || data.track || data.title) {
    artist = data.artist || '';
    title = data.song || data.track || data.title || '';
  }
  
  return parseArtistTitle(nowPlaying, artist, title);
}

// Expose helpers globally for the service worker
self.cleanNowPlaying = cleanNowPlaying;
self.fetchWithTimeout = fetchWithTimeout;
self.isValidMetadata = isValidMetadata;
self.parseArtistTitle = parseArtistTitle;
self.parseStationMetadata = parseStationMetadata;

// NTS Radio API integration
async function fetchNTSMetadata(station) {
  try {
    const stationUrl = station?.url || '';
    
    // Only use NTS API for main live channels (stream-relay)
    // Exclude mixtape channels (stream-mixtape) as they don't have now playing info
    if (!stationUrl.includes('stream-relay-geo.ntslive.net')) {
      // This is either a mixtape channel or not a main NTS live channel
      return null;
    }
    
    const response = await fetch('https://www.nts.live/api/v2/live', {
      cache: 'no-store',
      headers: {
        'User-Agent': 'RadioDock/1.0'
      }
    });
    
    if (!response.ok) throw new Error(`NTS API error: ${response.status}`);
    
    const data = await response.json();
    const channels = data.results || [];
    
    // Detect channel from stream URL
    let targetChannel = '1'; // default for /stream
    if (stationUrl.includes('/stream2')) {
      targetChannel = '2';
    }
    
    // Find the matching channel
    let channel = channels.find(r => r.channel_name === targetChannel) || channels[0];
    
    if (channel && channel.now) {
      const now = channel.now;
      
      // Use broadcast_title as the main content, it contains the track info
      let nowPlaying = now.broadcast_title || now.title || '';
      
      // If we have artist info from embeds, use that instead
      if (now.embeds?.details?.name) {
        nowPlaying = now.embeds.details.name;
      }
      
      nowPlaying = cleanNowPlaying(nowPlaying);
      
      return {
        source: 'NTS Radio API',
        nowPlaying: nowPlaying,
        channel: channel.channel_name === '2' ? 'NTS 2' : 'NTS 1',
        artwork: now.embeds?.details?.media?.picture_medium,
        startTime: now.start_timestamp,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('NTS API fetch failed:', error);
  }
  return null;
}

// Expose NTS fetcher globally
self.fetchNTSMetadata = fetchNTSMetadata;

// Cashmere Radio (Airtime Pro) integration
async function fetchCashmereMetadata(station) {
  try {
    // Cashmere Radio public live-info endpoint
    const endpoint = 'https://cashmereradio.airtime.pro/api/live-info-v2';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'RadioDock/1.0'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`Cashmere API error: ${response.status}`);

    const data = await response.json();

    // Use shared Airtime Pro parser to build "Show - Track" format
    let nowPlaying = parseAirtimeProNowPlaying(data);

    if (nowPlaying && nowPlaying.trim().length > 0) {
      return {
        source: 'Cashmere Radio API',
        nowPlaying: nowPlaying.trim(),
        timestamp: Date.now()
      };
    }

    return null;
  } catch (error) {
    console.error('Cashmere metadata fetch failed:', error);
    return null;
  }
}

// Expose Cashmere fetcher globally
self.fetchCashmereMetadata = fetchCashmereMetadata;

// Generic Airtime Pro integration (for stations using *.out.airtime.pro streams)
function deriveAirtimeProEndpointFromStream(streamUrl) {
  try {
    if (!streamUrl) return null;
    const u = new URL(streamUrl);
    const host = u.hostname || '';
    // Expect pattern like: <station>.out.airtime.pro
    const m = host.match(/^([^.]+)\.out\.airtime\.pro$/i);
    if (!m) return null;
    const stationKey = m[1];
    return `https://${stationKey}.airtime.pro/api/live-info-v2`;
  } catch (e) {
    return null;
  }
}

function parseAirtimeProNowPlaying(data) {
  // Prefer track-level info from Airtime Pro structure
  const currentTrack = data?.tracks?.current;
  const meta = currentTrack?.metadata;
  const rawArtist = (meta?.artist_name || meta?.artist || '').trim();
  // Explicit track_title when available; fallback to currentTrack.name (strip leading dashes)
  let rawTitle = (meta?.track_title || '').trim();
  if (!rawTitle && typeof currentTrack?.name === 'string') {
    rawTitle = currentTrack.name.replace(/^\s*-\s*/, '').trim();
  }

  // Show name from schedule
  const showNameRaw = (data?.shows?.current?.name || '').trim();
  const showName = showNameRaw && !/airtime/i.test(showNameRaw) && !/archive/i.test(showNameRaw)
    ? showNameRaw
    : '';

  // Build track component first (artist - title if both; else the one available)
  let trackComponent = null;
  if (rawArtist && rawTitle) trackComponent = `${rawArtist} - ${rawTitle}`;
  else if (rawTitle) trackComponent = rawTitle;
  else if (rawArtist) trackComponent = rawArtist;

  let nowPlaying = null;
  if (showName && trackComponent) {
    // Avoid duplicating if track already starts with show name
    const lcShow = showName.toLowerCase();
    const lcTrack = trackComponent.toLowerCase();
    if (!lcTrack.startsWith(lcShow + ' - ') && lcShow !== lcTrack) {
      nowPlaying = `${showName} - ${trackComponent}`;
    } else {
      nowPlaying = trackComponent;
    }
  } else if (trackComponent) {
    nowPlaying = trackComponent;
  } else if (showName) {
    nowPlaying = showName;
  }

  // Last-resort generic keys
  if (!nowPlaying) {
    const np = data?.now || data?.now_playing || data?.nowPlaying;
    if (typeof np === 'string') nowPlaying = np.trim();
    else if (np && (np.title || np.name)) nowPlaying = (np.title || np.name).trim();
  }

  return cleanNowPlaying(nowPlaying);
}

async function fetchAirtimeProMetadata(station, providedEndpoint) {
  try {
    const endpoint = providedEndpoint || deriveAirtimeProEndpointFromStream(station?.url);
    if (!endpoint) return null;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: { 'User-Agent': 'RadioDock/1.0' },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!response.ok) return null;

    const data = await response.json();
    let nowPlaying = parseAirtimeProNowPlaying(data);
    if (nowPlaying && nowPlaying.trim().length > 0) {
      return {
        source: 'Airtime Pro API',
        nowPlaying: nowPlaying.trim(),
        timestamp: Date.now()
      };
    }
    return null;
  } catch (e) {
    console.error('Airtime Pro metadata fetch failed:', e);
    return null;
  }
}

// Expose Airtime Pro helpers globally
self.fetchAirtimeProMetadata = fetchAirtimeProMetadata;
self.deriveAirtimeProEndpointFromStream = deriveAirtimeProEndpointFromStream;
