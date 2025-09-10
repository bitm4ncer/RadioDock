// Radio Dock Application
class RadioDock {
  constructor() {
    // Multiple station lists support
    this.stationLists = {
      'favorites': {
        id: 'favorites',
        name: 'Favorites',
        stations: []
      }
    };
    this.currentListId = 'favorites';
    this.communityListId = 'community-radios';
    
    // Legacy support - this will be computed from current list
    this.favorites = [];
    
    this.currentStation = null;
    this.isPlaying = false;
    this.isBuffering = false;
    this.manuallyPaused = false;
    this.searchTimeout = null;
    this.apiBaseUrl = 'https://de1.api.radio-browser.info';
    
    this.initializeElements();
    this.attachEventListeners();
    
    // Load data immediately - Chrome APIs should be available when popup opens
    this.loadStoredData();
    
    // Periodic sync to ensure state consistency during long playback
    this.setupPeriodicSync();
  }
  
  initializeElements() {
    // Container element
    this.container = document.querySelector('.container');
    
    // Player elements
    this.playPauseBtn = document.getElementById('playPauseBtn');
    this.playIcon = document.querySelector('.play-icon');
    this.pauseIcon = document.querySelector('.pause-icon');
    this.bufferingIcon = document.querySelector('.buffering-icon');
    
    this.stationLogo = document.getElementById('stationLogo');
    this.stationInitials = document.getElementById('stationInitials');
    this.stationName = document.getElementById('stationName');
    this.stationCountry = document.getElementById('stationCountry');
    this.visitStationBtn = document.getElementById('visitStationBtn');
    this.addToFavoritesBtn = document.getElementById('addToFavoritesBtn');
    
    // Now playing elements
    this.nowPlaying = document.getElementById('nowPlaying');
    this.nowPlayingText = document.getElementById('nowPlayingText');
    
    // Favorites elements
    this.favoritesList = document.getElementById('favoritesList');
    this.emptyState = document.getElementById('emptyState');
    
    // Search elements
    this.searchInput = document.getElementById('searchInput');
    this.clearSearchBtn = document.getElementById('clearSearchBtn');
    this.searchFilters = document.getElementById('searchFilters');
    this.searchResults = document.getElementById('searchResults');
    this.searchLoading = document.getElementById('searchLoading');
    this.searchResultsList = document.getElementById('searchResultsList');
    this.searchError = document.getElementById('searchError');
    
    // Search state
    this.currentSearchFilter = 'name';
    
    // Toast element
    this.toast = document.getElementById('toast');
    
    // Close button (optional - may not exist)
    this.closeBtn = document.getElementById('closeBtn');
    
    // List management elements
    this.currentListName = document.getElementById('currentListName');
    this.listDropdownBtn = document.getElementById('listDropdownBtn');
    this.listDropdownMenu = document.getElementById('listDropdownMenu');
    this.listItems = document.getElementById('listItems');
    this.addListBtn = document.getElementById('addListBtn');
    this.importListBtn = document.getElementById('importListBtn');
    this.importListFile = document.getElementById('importListFile');
    
    // Modal elements
    this.newListModal = document.getElementById('newListModal');
    this.closeModalBtn = document.getElementById('closeModalBtn');
    this.newListNameInput = document.getElementById('newListNameInput');
    this.listNameError = document.getElementById('listNameError');
    this.cancelListBtn = document.getElementById('cancelListBtn');
    this.createListBtn = document.getElementById('createListBtn');
    
    // Info modal elements
    this.infoModal = document.getElementById('infoModal');
    this.closeInfoModalBtn = document.getElementById('closeInfoModalBtn');
    this.dockLogo = document.querySelector('.dock-logo');
    
    // Confirmation modal elements
    this.confirmModal = document.getElementById('confirmModal');
    this.confirmTitle = document.getElementById('confirmTitle');
    this.confirmMessage = document.getElementById('confirmMessage');
    this.closeConfirmModalBtn = document.getElementById('closeConfirmModalBtn');
    this.cancelConfirmBtn = document.getElementById('cancelConfirmBtn');
    this.confirmActionBtn = document.getElementById('confirmActionBtn');
    
    // Prompt modal elements
    this.promptModal = document.getElementById('promptModal');
    this.promptTitle = document.getElementById('promptTitle');
    this.promptLabel = document.getElementById('promptLabel');
    this.promptInput = document.getElementById('promptInput');
    this.promptError = document.getElementById('promptError');
    this.closePromptModalBtn = document.getElementById('closePromptModalBtn');
    this.cancelPromptBtn = document.getElementById('cancelPromptBtn');
    this.confirmPromptBtn = document.getElementById('confirmPromptBtn');
    
    // Volume control elements
    this.volumeControls = document.querySelector('.volume-controls');
    this.volumeDots = document.querySelectorAll('.volume-dot');
    this.currentVolume = 100; // Default volume
  }
  
  attachEventListeners() {
    // Player controls
    this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
    
    // Volume controls
    this.volumeDots.forEach(dot => {
      dot.addEventListener('click', (e) => this.setVolume(parseInt(e.target.dataset.volume)));
    });
    
    // Search functionality
    this.searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
    this.searchInput.addEventListener('focus', () => this.showSearchResults());
    // Removed blur handler that was interfering with popup auto-closing
    // Search results now hide via input change or clear button instead
    
    this.clearSearchBtn.addEventListener('click', () => this.clearSearch());
    
    // Filter button functionality
    this.searchFilters.addEventListener('click', (e) => {
      if (e.target.classList.contains('filter-btn')) {
        this.setSearchFilter(e.target.getAttribute('data-filter'));
      }
    });
    
    // Close button functionality
    // Only add close button listener if it exists
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closePopup());
    }
    
    // Add to favorites button
    this.addToFavoritesBtn.addEventListener('click', () => this.addCurrentStationToFavorites());
    
    // Station logo click to visit homepage
    this.stationLogo.addEventListener('click', () => this.visitStationHomepage());
    this.stationInitials.addEventListener('click', () => this.visitStationHomepage());
    
    // List management events
    this.listDropdownBtn.addEventListener('click', () => this.toggleListDropdown());
    
    // Use event delegation for dropdown buttons (since dropdown might be hidden initially)
    this.listDropdownMenu.addEventListener('click', (e) => {
      if (e.target.closest('#addListBtn')) {
        e.stopPropagation(); // Prevent dropdown from closing
        this.showNewListModal();
      }
      if (e.target.closest('#importListBtn')) {
        e.stopPropagation(); // Prevent dropdown from closing
        this.importListFile.click();
      }
    });
    
    // Import list file handler
    this.importListFile.addEventListener('change', (e) => this.importListFromFile(e));
    
    // Modal events
    this.closeModalBtn.addEventListener('click', () => this.hideNewListModal());
    this.cancelListBtn.addEventListener('click', () => this.hideNewListModal());
    this.createListBtn.addEventListener('click', () => this.createNewList());
    this.newListNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.createNewList();
      if (e.key === 'Escape') this.hideNewListModal();
    });
    
    // Click outside dropdown to close - use container instead of document to avoid interfering with popup closing
    this.container.addEventListener('click', (e) => {
      if (!this.listDropdownBtn.contains(e.target) && !this.listDropdownMenu.contains(e.target)) {
        this.hideListDropdown();
      }
    });
    
    // Click outside modal to close
    this.newListModal.addEventListener('click', (e) => {
      if (e.target === this.newListModal) {
        this.hideNewListModal();
      }
    });
    
    // Info modal events
    this.dockLogo.addEventListener('click', () => this.showInfoModal());
    this.closeInfoModalBtn.addEventListener('click', () => this.hideInfoModal());
    
    // Click outside info modal to close
    this.infoModal.addEventListener('click', (e) => {
      if (e.target === this.infoModal) {
        this.hideInfoModal();
      }
    });
    
    // Confirmation modal events
    this.closeConfirmModalBtn.addEventListener('click', () => this.hideConfirmModal());
    this.cancelConfirmBtn.addEventListener('click', () => this.hideConfirmModal());
    
    // Click outside confirmation modal to close
    this.confirmModal.addEventListener('click', (e) => {
      if (e.target === this.confirmModal) {
        this.hideConfirmModal();
      }
    });
    
    // Prompt modal events
    this.closePromptModalBtn.addEventListener('click', () => this.hidePromptModal());
    this.cancelPromptBtn.addEventListener('click', () => this.hidePromptModal());
    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handlePromptConfirm();
      if (e.key === 'Escape') this.hidePromptModal();
    });
    
    // Click outside prompt modal to close
    this.promptModal.addEventListener('click', (e) => {
      if (e.target === this.promptModal) {
        this.hidePromptModal();
      }
    });
    
    // Listen for messages from background/offscreen
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        this.handleRuntimeMessage(message);
        sendResponse({ received: true }); // Acknowledge receipt
        return true; // Keep message channel open
      });
    }
  }
  
  async loadStoredData() {
    
    // Optimized retry strategy with exponential backoff
    const maxRetries = 3;
    const baseDelay = 50;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const delay = baseDelay * Math.pow(2, attempt); // 50ms, 100ms, 200ms
      
      try {
        // Use Promise.race for timeout protection
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Chrome storage timeout')), 2000)
        );
        
        const storagePromise = chrome.storage.sync.get([
          'stationLists', 'currentListId', 'favorites', 'currentStation', 'isPlaying'
        ]);
        
        const result = await Promise.race([storagePromise, timeoutPromise]);
        
        // Validate the result structure
        if (result && typeof result === 'object') {
          // Handle new multiple lists structure
          if (result.stationLists && typeof result.stationLists === 'object') {
            this.stationLists = result.stationLists;
            this.currentListId = result.currentListId || 'favorites';
          } 
          // Handle legacy favorites data (migration)
          else if (Array.isArray(result.favorites)) {
            this.stationLists = {
              'favorites': {
                id: 'favorites',
                name: 'Favorites',
                stations: result.favorites
              }
            };
            this.currentListId = 'favorites';
          }
          
          // Sync legacy favorites array
          this.syncLegacyFavorites();
          
          this.currentStation = result.currentStation || null;
          this.isPlaying = result.isPlaying || false;
          
          
          // Load community radios and sync state in parallel
          const [,] = await Promise.allSettled([
            this.loadCommunityRadios(),
            this.syncPlayingState()
          ]);
          
          // Update UI
          this.renderFavorites();
          this.updatePlayerUI();
          this.updateListUI();
          document.getElementById('playerCard').classList.add('loaded');
          
          return; // Success, exit the function
        } else {
          throw new Error('Invalid storage result structure');
        }
        
      } catch (error) {
        
        // Check for specific error types that shouldn't be retried
        if (error.message.includes('Extension context invalidated') || 
            error.message.includes('chrome.storage is undefined')) {
          console.warn('Chrome extension context issues, skipping to localStorage');
          break;
        }
        
        // Wait before retrying (except on last attempt)
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // If all Chrome storage attempts failed, use localStorage
    console.warn('All Chrome storage attempts failed, using localStorage fallback');
    try {
      this.loadFromLocalStorage();
      
      // Try to sync state but don't block on it
      this.syncPlayingState().catch(error => 
        console.warn('Failed to sync playing state from localStorage:', error)
      );
      
      this.renderFavorites();
      this.updatePlayerUI();
      this.updateListUI();
      document.getElementById('playerCard').classList.add('loaded');
    } catch (fallbackError) {
      console.error('localStorage fallback also failed:', fallbackError);
      this.handleStorageError();
    }
  }
  
  loadFromLocalStorage() {
    try {
      const stationLists = localStorage.getItem('radio-dock-station-lists');
      const currentListId = localStorage.getItem('radio-dock-current-list-id');
      const favorites = localStorage.getItem('radio-dock-favorites');
      const currentStation = localStorage.getItem('radio-dock-current-station');
      const isPlaying = localStorage.getItem('radio-dock-is-playing');
      
      // Handle new multiple lists structure
      if (stationLists) {
        this.stationLists = JSON.parse(stationLists);
        this.currentListId = currentListId || 'favorites';
      } 
      // Handle legacy favorites data (migration)
      else if (favorites) {
        this.stationLists = {
          'favorites': {
            id: 'favorites',
            name: 'Favorites',
            stations: JSON.parse(favorites)
          }
        };
        this.currentListId = 'favorites';
      }
      
      // Sync legacy favorites array
      this.syncLegacyFavorites();
      
      this.currentStation = currentStation ? JSON.parse(currentStation) : null;
      this.isPlaying = isPlaying === 'true';
      
    } catch (error) {
      console.error('localStorage fallback failed:', error);
      this.stationLists = {
        'favorites': {
          id: 'favorites',
          name: 'Favorites',
          stations: []
        }
      };
      this.currentListId = 'favorites';
      this.syncLegacyFavorites();
      this.currentStation = null;
      this.isPlaying = false;
    }
  }
  
  async handleStorageError() {
    try {
      this.loadFromLocalStorage();
      await this.syncPlayingState();
      this.renderFavorites();
      this.updatePlayerUI();
      this.updateListUI();
      // Show player after data is loaded
      document.getElementById('playerCard').classList.add('loaded');
      this.showToast('Loaded data from backup storage', 'info');
    } catch (fallbackError) {
      console.error('All storage methods failed:', fallbackError);
      this.stationLists = {
        'favorites': {
          id: 'favorites',
          name: 'Favorites',
          stations: []
        }
      };
      this.currentListId = 'favorites';
      this.syncLegacyFavorites();
      this.currentStation = null;
      this.isPlaying = false;
      this.renderFavorites();
      this.updatePlayerUI();
      this.updateListUI();
      // Show player even if no data loaded
      document.getElementById('playerCard').classList.add('loaded');
      this.showToast('Unable to load saved data', 'error');
    }
  }
  
  async loadCommunityRadios() {
    try {
      const response = await fetch(chrome.runtime.getURL('community-radios.json'));
      if (!response.ok) {
        return;
      }
      
      const communityData = await response.json();
      
      // Check if we already have the community list and if it needs updating
      const existingList = this.stationLists[this.communityListId];
      
      // Always update or create the community list to stay in sync
      this.stationLists[this.communityListId] = {
        id: this.communityListId,
        name: communityData.listName || 'Community Radios',
        stations: communityData.stations || [],
        isLinked: true, // Mark as linked list
        version: communityData.version,
        lastUpdated: communityData.exportDate
      };
      
      
    } catch (error) {
      console.error('Failed to load community-radios.json:', error);
    }
  }
  
  async saveData() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
        await chrome.storage.sync.set({
          stationLists: this.stationLists,
          currentListId: this.currentListId,
          favorites: this.favorites, // Keep for backward compatibility
          currentStation: this.currentStation,
          isPlaying: this.isPlaying
        });
      } else {
        // Fallback to localStorage
        localStorage.setItem('radio-dock-station-lists', JSON.stringify(this.stationLists));
        localStorage.setItem('radio-dock-current-list-id', this.currentListId);
        localStorage.setItem('radio-dock-favorites', JSON.stringify(this.favorites)); // Keep for backward compatibility
        localStorage.setItem('radio-dock-current-station', JSON.stringify(this.currentStation));
        localStorage.setItem('radio-dock-is-playing', this.isPlaying.toString());
      }
    } catch (error) {
      console.error('Error saving data:', error);
    }
  }
  
  async syncPlayingState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_PLAYING_STATE' });
        if (response) {
          if (typeof response.isPlaying === 'boolean') {
            this.isPlaying = response.isPlaying;
          }
          // Reset manual pause state if audio is actually playing
          if (response.isPlaying && !response.isPaused) {
            this.manuallyPaused = false;
          }
          // Update metadata if available
          if (response.metadata) {
            this.updateMetadataDisplay(response.metadata);
          }
        }
      }
    } catch (error) {
      console.error('Error syncing playing state:', error);
    }
  }
  
  setupPeriodicSync() {
    // Clear any existing interval first to prevent duplicates
    this.clearPeriodicSync();
    
    // Sync playing state every 30 seconds to handle long playback sessions
    this.syncInterval = setInterval(async () => {
      try {
        if (this.currentStation && this.isPlaying) {
          await this.syncPlayingState();
          this.updatePlayerUI();
          this.renderFavorites(); // Update playing indicators
        }
      } catch (error) {
        console.error('Error in periodic sync:', error);
        // Clear interval on error to prevent continuous errors
        this.clearPeriodicSync();
      }
    }, 30000);
    
    // Multiple cleanup strategies for better reliability
    window.addEventListener('beforeunload', () => {
      this.clearPeriodicSync();
    });
    
    // Also cleanup on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.clearPeriodicSync();
      } else if (this.currentStation && this.isPlaying && !this.syncInterval) {
        // Restart sync when page becomes visible again
        this.setupPeriodicSync();
      }
    });
  }
  
  clearPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
  
  updateMetadataDisplay(metadata) {
    // Always hide when metadata is null or empty
    if (!metadata || !metadata.nowPlaying) {
      this.nowPlaying.classList.remove('show');
      this.nowPlayingText.textContent = '';
      this.nowPlayingText.classList.remove('can-scroll');
      return;
    }
    
    // Use the nowPlaying field which contains the formatted metadata
    let displayText = metadata.nowPlaying;
    
    this.nowPlayingText.textContent = displayText;
    this.nowPlaying.classList.add('show');
    
    // Calculate if hover scrolling is needed
    setTimeout(() => {
      this.setupHoverScroll();
    }, 50); // Small delay to ensure element is rendered
    
  }

  setupHoverScroll() {
    if (!this.nowPlayingText) return;
    
    const container = this.nowPlayingText;
    
    // Reset classes and styles
    container.classList.remove('can-scroll');
    container.style.removeProperty('--scroll-duration');
    container.style.removeProperty('--scroll-distance');
    
    // Wait for layout to be calculated
    requestAnimationFrame(() => {
      const containerWidth = 195; // Fixed width from CSS
      
      // Create a temporary element to measure full text width
      const measureElement = document.createElement('span');
      measureElement.style.visibility = 'hidden';
      measureElement.style.position = 'absolute';
      measureElement.style.whiteSpace = 'nowrap';
      measureElement.style.fontSize = '13px';
      measureElement.style.fontWeight = '500';
      measureElement.textContent = container.textContent;
      document.body.appendChild(measureElement);
      
      const textWidth = measureElement.offsetWidth;
      document.body.removeChild(measureElement);
      
      // Only enable hover scroll if text overflows
      if (textWidth > containerWidth) {
        // Calculate scroll distance to show all text (from start to end)
        const scrollDistance = textWidth - containerWidth + 20; // Extra 20px padding
        const duration = Math.max(2.5, scrollDistance / 50); // Minimum 2.5s, slower speed for readability
        
        // Set CSS custom properties
        container.style.setProperty('--scroll-distance', `-${scrollDistance}px`);
        container.style.setProperty('--scroll-duration', `${duration}s`);
        container.classList.add('can-scroll');
      }
    });
  }
  
  handleRuntimeMessage(message) {
    switch (message.type) {
      case 'AUDIO_BUFFERING':
        this.setBufferingState(true);
        this.isPlaying = false; // Not actually playing yet
        this.updatePlayerUI();
        break;
      case 'AUDIO_PLAYING':
        // Only update to playing if we're not manually paused
        if (!this.manuallyPaused) {
          this.setBufferingState(false);
          this.isPlaying = true;
          this.updatePlayerUI();
        }
        break;
      case 'AUDIO_PAUSED':
      case 'AUDIO_ENDED':
        this.setBufferingState(false);
        this.isPlaying = false;
        this.updatePlayerUI();
        break;
      case 'AUDIO_ERROR':
        this.setBufferingState(false);
        this.isPlaying = false;
        this.manuallyPaused = false; // Clear manual pause on error
        this.updatePlayerUI();
        this.showToast(message.error || 'Audio playback error', 'error');
        break;
      case 'STATION_CHANGED':
        // Update current station when changed via context menu
        this.currentStation = message.station;
        this.updatePlayerUI();
        this.renderFavorites(); // Update favorites list to show .playing state
        this.saveData();
        break;
      case 'METADATA_UPDATE':
        // Handle now playing metadata updates
        this.updateMetadataDisplay(message.metadata);
        break;
    }
  }
  
  async togglePlayPause() {
  if (!this.currentStation) {
    this.showToast('No station selected', 'error');
    return;
  }

  // No loading icon; buffering state will be shown via AUDIO_BUFFERING

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      if (this.isPlaying || this.isBuffering) {
        await chrome.runtime.sendMessage({ type: 'PAUSE_STATION' });
        this.isPlaying = false;
        this.manuallyPaused = true;
        this.setBufferingState(false);
      } else {
        this.manuallyPaused = false;
        await chrome.runtime.sendMessage({
          type: 'PLAY_STATION',
          station: this.currentStation
        });
        // Buffering/playing UI will be updated by incoming AUDIO_* messages
      }
    } else {
      // Fallback for testing without extension context
      console.warn('Chrome runtime not available - simulating playback');
      if (this.isPlaying || this.isBuffering) {
        this.isPlaying = false;
        this.setBufferingState(false);
        this.showToast('Paused (simulated)', 'info');
      } else {
        this.handleRuntimeMessage({ type: 'AUDIO_BUFFERING' });
        this.showToast('Buffering (simulated)', 'info');
        setTimeout(() => {
          this.handleRuntimeMessage({ type: 'AUDIO_PLAYING' });
          this.showToast('Playing (simulated)', 'info');
        }, 2000);
      }
    }

    this.updatePlayerUI();
    this.saveData();
  } catch (error) {
    console.error('Error toggling playback:', error);
    this.showToast('Playback error', 'error');
  } finally {
    // No loading icon; ensure UI reflects current state
    this.updatePlayerUI();
  }
}
  
  setBufferingState(buffering) {
    this.isBuffering = buffering;
    this.playPauseBtn.disabled = buffering;
    
    if (buffering) {
      this.playIcon.style.display = 'none';
      this.pauseIcon.style.display = 'none';
      this.bufferingIcon.style.display = 'inline';
    } else {
      this.bufferingIcon.style.display = 'none';
      this.playIcon.style.display = this.isPlaying ? 'none' : 'inline';
      this.pauseIcon.style.display = this.isPlaying ? 'inline' : 'none';
    }
  }
  
  updatePlayerUI() {
    if (this.currentStation) {
      this.stationName.textContent = this.currentStation.name;
      this.stationCountry.textContent = this.formatCountryCode(this.currentStation.countrycode);
      
      if (this.currentStation.favicon && this.isValidFaviconUrl(this.currentStation.favicon)) {
        this.stationLogo.src = this.currentStation.favicon;
        this.stationLogo.style.display = 'block';
        this.stationInitials.style.display = 'none';
        
        this.stationLogo.onerror = () => {
          this.stationLogo.style.display = 'none';
          this.stationInitials.style.display = 'flex';
          this.stationInitials.textContent = this.getStationInitials(this.currentStation.name);
        };
      } else {
        this.stationLogo.style.display = 'none';
        this.stationInitials.style.display = 'flex';
        this.stationInitials.textContent = this.getStationInitials(this.currentStation.name);
      }
      
      if (this.currentStation.homepage) {
        this.visitStationBtn.href = this.currentStation.homepage;
        
        // Create clean URL display (just the domain name)
        let cleanUrl = this.currentStation.homepage
          .replace(/^https?:\/\//, '')     // Remove http:// or https://
          .replace(/^www\d*\./, '')       // Remove www, www1, www2, etc.
          .split('/')[0];                 // Keep only domain, remove path
        
        this.visitStationBtn.textContent = cleanUrl;
        this.visitStationBtn.style.display = 'block';
      } else {
        this.visitStationBtn.style.display = 'none';
      }
      
      // Show heart icon if current station is not in favorites
      const isInFavorites = this.favorites.some(fav => fav.id === this.currentStation.id);
      this.addToFavoritesBtn.style.display = isInFavorites ? 'none' : 'block';
    } else {
      this.stationName.textContent = 'No station selected';
      this.stationCountry.textContent = '';
      this.stationLogo.style.display = 'none';
      this.stationInitials.style.display = 'flex';
      this.stationInitials.textContent = '';
      this.visitStationBtn.style.display = 'none';
      this.addToFavoritesBtn.style.display = 'none';
    }
    
    // Update play/pause button state without affecting buffering
    if (!this.isBuffering) {
      this.playIcon.style.display = this.isPlaying ? 'none' : 'inline';
      this.pauseIcon.style.display = this.isPlaying ? 'inline' : 'none';
    }
    this.renderFavorites();
  }
  
  formatCountryCode(code) {
    if (!code) return '';
    if (code.toUpperCase() === 'US') return 'USA';
    return code.toUpperCase();
  }
  
  getStationInitials(name) {
    if (!name) return '';
    const words = name.split(' ').filter(word => word.length > 0);
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    } else if (words.length === 1) {
      return words[0].substring(0, 2).toUpperCase();
    }
    return 'R';
  }
  
  renderFavorites() {
    if (this.favorites.length === 0) {
      this.emptyState.style.display = 'block';
      this.favoritesList.innerHTML = '<div class="empty-state" id="emptyState"><p>Search stations below to add them!</p></div>';
      return;
    }
    
    this.emptyState.style.display = 'none';
    
    const favoritesHTML = this.favorites.map(station => {
      const isPlaying = this.currentStation && this.currentStation.id === station.id && (this.isPlaying || this.isBuffering);
      
      return `
        <div class="station-item ${isPlaying ? 'playing' : ''}" data-station-id="${station.id}">
          ${station.favicon && this.isValidFaviconUrl(station.favicon) ? 
            `<img class="station-item-logo" src="${station.favicon}" alt="${station.name}">
             <div class="station-item-initials" style="display: none;">${this.getStationInitials(station.name)}</div>` :
            `<div class="station-item-initials">${this.getStationInitials(station.name)}</div>`
          }
          <div class="station-item-info">
            <div class="station-item-name">${this.escapeHtml(station.name)}</div>
            <div class="station-item-country">${this.formatCountryCode(station.countrycode)}</div>
          </div>
          <div class="station-item-actions">
            <button class="btn-icon btn-drag" title="Drag to reorder">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="8.5" width="12" height="1.5" rx="0.75"/>
                <rect x="6" y="14" width="12" height="1.5" rx="0.75"/>
              </svg>
            </button>
            <button class="btn-icon btn-remove" title="Remove from favorites" data-station-id="${station.id}">✕</button>
          </div>
        </div>
      `;
    }).join('');
    
    this.favoritesList.innerHTML = favoritesHTML;
    
    // Add event listeners to station items
    this.favoritesList.querySelectorAll('.station-item').forEach(item => {
      // Handle station logo errors
      const logo = item.querySelector('.station-item-logo');
      const initials = item.querySelector('.station-item-initials');
      if (logo && initials) {
        logo.onerror = () => {
          logo.style.display = 'none';
          initials.style.display = 'flex';
        };
      }
      
      // Handle station item clicks
      item.addEventListener('click', (e) => {
        // Don't play if clicking on actions or if item was just dragged
        if (!e.target.closest('.station-item-actions') && !item.classList.contains('dragging')) {
          const stationId = item.getAttribute('data-station-id');
          this.playFavorite(stationId);
        }
      });
    });
    
    // Add event listeners to remove buttons
    this.favoritesList.querySelectorAll('.btn-remove').forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const stationId = button.getAttribute('data-station-id');
        this.removeFavorite(stationId);
      });
    });
    
    // Add drag functionality
    this.setupDragAndDrop();
  }
  
  async playFavorite(stationId) {
    const station = this.favorites.find(s => s.id === stationId);
    if (!station) return;
    
    this.currentStation = station;
    this.isPlaying = false;
    
    this.updatePlayerUI();
    await this.saveData();
    
    // Auto-play the station
    this.togglePlayPause();
  }
  
  removeFavorite(stationId) {
    const newStations = this.favorites.filter(s => s.id !== stationId);
    this.updateCurrentList(newStations);
    
    if (this.currentStation && this.currentStation.id === stationId) {
      this.currentStation = null;
      this.isPlaying = false;
      
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'STOP_STATION' });
      }
    }
    
    this.renderFavorites();
    this.updatePlayerUI();
    this.updateListUI(); // Update the list selector UI
    this.saveData();
    
    // Notify background script
    this.notifyBackgroundFavoritesUpdate();
    
    // Update search results if they are visible to refresh add/checkmark buttons
    this.refreshSearchResults();
    
    this.showToast(`Station removed from ${this.getCurrentList().name}`, 'success');
  }
  
  setupDragAndDrop() {
    let draggedItem = null;
    let draggedIndex = -1;
    
    const stationItems = this.favoritesList.querySelectorAll('.station-item');
    
    stationItems.forEach((item, index) => {
      const dragHandle = item.querySelector('.btn-drag');
      if (!dragHandle) return;
      
      // Make drag handle draggable
      dragHandle.setAttribute('draggable', 'true');
      
      // Prevent click events on drag handle
      dragHandle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      
      // Drag handle events
      dragHandle.addEventListener('dragstart', (e) => {
        draggedItem = item;
        draggedIndex = index;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', item.outerHTML);
      });
      
      dragHandle.addEventListener('dragend', () => {
        if (draggedItem) {
          draggedItem.classList.remove('dragging');
        }
        // Clean up all drag states
        stationItems.forEach(i => i.classList.remove('drag-over'));
        draggedItem = null;
        draggedIndex = -1;
      });
      
      // Station item drop events
      item.addEventListener('dragover', (e) => {
        if (draggedItem && draggedItem !== item) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          item.classList.add('drag-over');
        }
      });
      
      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });
      
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        
        if (draggedItem && draggedItem !== item && draggedIndex !== -1) {
          const dropIndex = Array.from(stationItems).indexOf(item);
          this.reorderStations(draggedIndex, dropIndex);
        }
      });
    });
  }
  
  reorderStations(fromIndex, toIndex) {
    const newFavorites = [...this.favorites];
    const [movedStation] = newFavorites.splice(fromIndex, 1);
    newFavorites.splice(toIndex, 0, movedStation);
    
    this.updateCurrentList(newFavorites);
    this.renderFavorites();
    this.saveData();
    this.notifyBackgroundFavoritesUpdate();
  }
  
  handleSearchInput(query) {
    clearTimeout(this.searchTimeout);
    
    if (query.trim().length === 0) {
      this.searchFilters.style.display = 'none';
      this.hideSearchResults();
      return;
    }
    
    this.searchFilters.style.display = 'flex';
    this.showSearchResults();
    
    this.searchTimeout = setTimeout(() => {
      this.searchStations(query.trim());
    }, 500);
  }
  
  async searchStations(query) {
    if (!query) return;
    
    this.showSearchLoading(true);
    
    try {
      let url;
      
      // Build URL based on selected filter
      switch (this.currentSearchFilter) {
        case 'tag':
          url = `${this.apiBaseUrl}/json/stations/bytag/${encodeURIComponent(query)}?hidebroken=true&limit=50&order=clickcount&reverse=true`;
          break;
        case 'country':
          url = `${this.apiBaseUrl}/json/stations/bycountry/${encodeURIComponent(query)}?hidebroken=true&limit=50&order=clickcount&reverse=true`;
          break;
        case 'name':
        default:
          url = `${this.apiBaseUrl}/json/stations/search?name=${encodeURIComponent(query)}&hidebroken=true&limit=50&order=clickcount&reverse=true`;
          break;
      }
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'RadioDock/1.0'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const stations = await response.json();
      this.renderSearchResults(stations);
      
    } catch (error) {
      console.error('Search error:', error);
      this.showSearchError(true);
    } finally {
      this.showSearchLoading(false);
    }
  }
  
  renderSearchResults(stations) {
    this.showSearchError(false);
    
    if (stations.length === 0) {
      this.searchResultsList.innerHTML = '<div class="search-error"><p>No stations found</p></div>';
      return;
    }
    
    const resultsHTML = stations.slice(0, 20).map(station => {
      const stationData = {
        id: station.stationuuid,
        name: station.name || 'Unknown Station',
        url: station.url,
        homepage: station.homepage || '',
        favicon: station.favicon || '',
        countrycode: station.countrycode || ''
      };
      
      const isAlreadyFavorite = this.favorites.some(fav => fav.id === stationData.id);
      
      return `
        <div class="search-item" data-station='${JSON.stringify(stationData).replace(/'/g, "&apos;")}'>
          ${stationData.favicon && this.isValidFaviconUrl(stationData.favicon) ? 
            `<img class="station-item-logo" src="${stationData.favicon}" alt="${stationData.name}">
             <div class="station-item-initials" style="display: none;">${this.getStationInitials(stationData.name)}</div>` :
            `<div class="station-item-initials">${this.getStationInitials(stationData.name)}</div>`
          }
          <div class="station-item-info">
            <div class="station-item-name">${this.escapeHtml(stationData.name)}</div>
            <div class="station-item-country">${this.formatCountryCode(stationData.countrycode)}</div>
          </div>
          <div class="search-item-actions">
            ${!isAlreadyFavorite ? 
              '<button class="btn-icon btn-add" title="Add to favorites"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="heart-icon"><path d="M16.5 3C19.5376 3 22 5.5 22 9C22 16 14.5 20 12 21.5C9.5 20 2 16 2 9C2 5.5 4.5 3 7.5 3C9.35997 3 11 4 12 5C13 4 14.64 3 16.5 3Z"></path></svg></button>' : 
              '<button class="btn-icon" title="Already in favorites" disabled>✓</button>'
            }
          </div>
        </div>
      `;
    }).join('');
    
    this.searchResultsList.innerHTML = resultsHTML;
    
    // Setup favicon error handling for search results
    this.setupFaviconErrorHandling(this.searchResultsList);
    
    // Add event listeners to search result items
    this.searchResultsList.querySelectorAll('.search-item').forEach(item => {
      // Handle station logo errors
      const logo = item.querySelector('.station-item-logo');
      const initials = item.querySelector('.station-item-initials');
      if (logo && initials) {
        logo.onerror = () => {
          logo.style.display = 'none';
          initials.style.display = 'flex';
        };
      }
      
      // Handle entire item click to preview station
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.search-item-actions')) {
          this.previewStation(item);
        }
      });
      
      // Handle add to favorites button clicks
      const addBtn = item.querySelector('.btn-add');
      if (addBtn) {
        addBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.addToFavorites(item);
        });
      }
    });
  }
  
  previewStation(item) {
    const stationData = JSON.parse(item.getAttribute('data-station'));
    
    this.currentStation = stationData;
    this.isPlaying = false;
    
    this.updatePlayerUI();
    this.togglePlayPause();
  }
  
  addToFavorites(item) {
    const stationData = JSON.parse(item.getAttribute('data-station'));
    
    // Check for duplicates
    if (this.favorites.some(fav => fav.id === stationData.id)) {
      this.showToast('Station already in current list', 'error');
      return;
    }
    
    const newStations = [...this.favorites, stationData];
    this.updateCurrentList(newStations);
    
    this.renderFavorites();
    this.saveData();
    this.updateListUI(); // Update the list selector UI
    
    // Notify background script
    this.notifyBackgroundFavoritesUpdate();
    
    this.showToast(`Station added to ${this.getCurrentList().name}`, 'success');
    
    // Update search results to refresh add/checkmark buttons
    this.refreshSearchResults();
  }
  
  showSearchResults() {
    document.body.classList.add('search-active');
    this.searchResults.style.display = 'block';
  }
  
  hideSearchResults() {
    if (this.searchInput.value.trim().length === 0) {
      document.body.classList.remove('search-active');
      this.searchResults.style.display = 'none';
      this.searchFilters.style.display = 'none';
    }
  }
  
  forceHideSearchResults() {
    document.body.classList.remove('search-active');
    this.searchResults.style.display = 'none';
    this.searchFilters.style.display = 'none';
  }
  
  clearSearch() {
    this.searchInput.value = '';
    this.forceHideSearchResults();
  }
  
  refreshSearchResults() {
    // Only refresh if search results are currently visible and we have search results
    if (this.searchResults.style.display === 'block' && this.searchResultsList.children.length > 0) {
      // Get current search results and re-render them to update add/checkmark buttons
      const searchItems = Array.from(this.searchResultsList.querySelectorAll('.search-item'));
      const stations = searchItems.map(item => {
        const stationData = JSON.parse(item.getAttribute('data-station'));
        // Convert back to the API format expected by renderSearchResults
        return {
          stationuuid: stationData.id,
          name: stationData.name,
          url: stationData.url,
          homepage: stationData.homepage,
          favicon: stationData.favicon,
          countrycode: stationData.countrycode
        };
      });
      this.renderSearchResults(stations);
    }
  }
  
  setSearchFilter(filter) {
    this.currentSearchFilter = filter;
    
    // Update active button
    this.searchFilters.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    this.searchFilters.querySelector(`[data-filter="${filter}"]`).classList.add('active');
    
    // Re-run search if there's a query
    if (this.searchInput.value.trim()) {
      this.searchStations(this.searchInput.value.trim());
    }
  }
  
  setVolume(volume) {
    this.currentVolume = volume;
    
    // Remove all existing volume classes
    this.volumeControls.classList.remove('volume-20', 'volume-40', 'volume-60', 'volume-80', 'volume-100');
    
    // Add the appropriate volume class
    this.volumeControls.classList.add(`volume-${volume}`);
    
    // Send volume change to background script for audio control
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'SET_VOLUME',
        volume: volume / 100 // Convert to 0-1 range
      }).catch(() => {
        // Ignore errors if extension context is not available
      });
    }
    
  }
  
  showSearchLoading(show) {
    this.searchLoading.style.display = show ? 'block' : 'none';
    this.searchResultsList.style.display = show ? 'none' : 'block';
  }
  
  showSearchError(show) {
    this.searchError.style.display = show ? 'block' : 'none';
    this.searchResultsList.style.display = show ? 'none' : 'block';
  }
  
  showToast(message, type = 'info') {
    this.toast.textContent = message;
    this.toast.className = `toast ${type}`;
    this.toast.classList.add('show');
    
    setTimeout(() => {
      this.toast.classList.remove('show');
    }, 3000);
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  exportList(listId) {
    const list = this.stationLists[listId];
    if (!list) return;
    
    if (list.stations.length === 0) {
      this.showToast(`No stations to export from ${list.name}`, 'error');
      return;
    }
    
    const exportData = {
      version: '2.0', // Updated version for multiple lists support
      exportDate: new Date().toISOString(),
      listName: list.name,
      stations: list.stations
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    const listNameForFile = list.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    link.download = `radio-dock-${listNameForFile}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    
    this.showToast(`Exported ${list.stations.length} stations from ${list.name}`, 'success');
  }
  
  exportFavorites() {
    // Legacy function - now exports current list
    this.exportList(this.currentListId);
  }
  
  async importFavorites(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      // Validate the import data structure
      if (!importData.stations || !Array.isArray(importData.stations)) {
        throw new Error('Invalid file format');
      }
      
      let addedCount = 0;
      let duplicateCount = 0;
      
      // Process each imported station
      for (const station of importData.stations) {
        // Validate required station properties
        if (!station.id || !station.name || !station.url) {
          continue;
        }
        
        // Check if station already exists in current list
        const exists = this.favorites.some(fav => fav.id === station.id);
        if (!exists) {
          const newStations = [...this.favorites, {
            id: station.id,
            name: station.name,
            url: station.url,
            homepage: station.homepage || '',
            favicon: station.favicon || '',
            countrycode: station.countrycode || ''
          }];
          this.updateCurrentList(newStations);
          addedCount++;
        } else {
          duplicateCount++;
        }
      }
      
      if (addedCount > 0) {
        this.renderFavorites();
        this.updateListUI(); // Update list selector with new count
        await this.saveData();
        
        // Notify background script
        this.notifyBackgroundFavoritesUpdate();
        
        const currentListName = this.getCurrentList().name;
        let message = `Added ${addedCount} stations to ${currentListName}`;
        if (duplicateCount > 0) {
          message += `, ${duplicateCount} duplicates skipped`;
        }
        this.showToast(message, 'success');
      } else {
        this.showToast('No new stations to import', 'info');
      }
      
    } catch (error) {
      console.error('Import error:', error);
      this.showToast('Invalid JSON file', 'error');
    } finally {
      // Clear the file input
      event.target.value = '';
    }
  }
  
  async importListFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const importData = JSON.parse(text);
      
      // Validate the import data structure
      if (!importData.stations || !Array.isArray(importData.stations)) {
        throw new Error('Invalid file format');
      }
      
      if (importData.stations.length === 0) {
        this.showToast('No stations found in the file', 'error');
        return;
      }
      
      // Get list name from import data or use filename
      let listName = importData.listName || file.name.replace(/\.[^/.]+$/, "");
      
      // Make sure name doesn't exceed length limit
      if (listName.length > 50) {
        listName = listName.substring(0, 47) + '...';
      }
      
      // Check for duplicate names and append number if needed
      const existingNames = Object.values(this.stationLists).map(list => list.name.toLowerCase());
      let finalName = listName;
      let counter = 1;
      while (existingNames.includes(finalName.toLowerCase())) {
        finalName = `${listName} (${counter})`;
        counter++;
      }
      
      // Create new list with imported stations
      const listId = 'list_' + Date.now();
      const validStations = [];
      
      // Process each imported station
      for (const station of importData.stations) {
        // Validate required station properties
        if (station.id && station.name && station.url) {
          validStations.push({
            id: station.id,
            name: station.name,
            url: station.url,
            homepage: station.homepage || '',
            favicon: station.favicon || '',
            countrycode: station.countrycode || ''
          });
        }
      }
      
      if (validStations.length === 0) {
        this.showToast('No valid stations found in the file', 'error');
        return;
      }
      
      // Create the new list
      this.stationLists[listId] = {
        id: listId,
        name: finalName,
        stations: validStations
      };
      
      // Switch to the new list and save
      this.switchToList(listId);
      this.hideListDropdown();
      
      this.showToast(`Imported ${validStations.length} stations as "${finalName}"`, 'success');
      
    } catch (error) {
      console.error('Import error:', error);
      this.showToast('Invalid JSON file', 'error');
    } finally {
      // Clear the file input
      event.target.value = '';
    }
  }
  
  closePopup() {
    if (typeof window !== 'undefined') {
      window.close();
    }
  }
  
  
  // Multiple station lists helper methods
  getCurrentList() {
    return this.stationLists[this.currentListId];
  }
  
  syncLegacyFavorites() {
    // Keep legacy favorites array in sync with current list for backward compatibility
    this.favorites = this.getCurrentList().stations;
  }
  
  updateCurrentList(stations) {
    this.stationLists[this.currentListId].stations = stations;
    this.syncLegacyFavorites();
  }
  
  // List management UI methods
  updateListUI() {
    this.currentListName.textContent = this.getCurrentList().name;
    this.renderListDropdown();
  }
  
  renderListDropdown() {
    this.listItems.innerHTML = '';
    
    // Sort lists to show active list first, then others
    const sortedLists = Object.values(this.stationLists).sort((a, b) => {
      // Active list goes first
      if (a.id === this.currentListId) return -1;
      if (b.id === this.currentListId) return 1;
      // Then sort alphabetically
      return a.name.localeCompare(b.name);
    });
    
    sortedLists.forEach(list => {
      const listItem = document.createElement('div');
      listItem.className = `list-item ${list.id === this.currentListId ? 'active' : ''}`;
      
      // Only allow deletion of non-favorites lists and if not the only list
      const canDelete = list.id !== 'favorites' && Object.keys(this.stationLists).length > 1;
      
      listItem.innerHTML = `
        <div class="list-item-content">
          <span class="list-name">${list.name}</span>
          <div class="list-item-actions">
            <button class="list-edit-btn" title="Edit list name" data-list-id="${list.id}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="action-icon">
                <path d="M12.8995 6.85453L17.1421 11.0972L7.24264 20.9967H3V16.754L12.8995 6.85453ZM14.3137 5.44032L16.435 3.319C16.8256 2.92848 17.4587 2.92848 17.8492 3.319L20.6777 6.14743C21.0682 6.53795 21.0682 7.17112 20.6777 7.56164L18.5563 9.68296L14.3137 5.44032Z"></path>
              </svg>
            </button>
            <button class="list-export-btn" title="Export ${list.name}" data-list-id="${list.id}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="action-icon">
                <path d="M3 19H21V21H3V19ZM13 13.1716L19.0711 7.1005L20.4853 8.51472L12 17L3.51472 8.51472L4.92893 7.1005L11 13.1716V2H13V13.1716Z"></path>
              </svg>
            </button>
            ${canDelete ? '<button class="list-remove-btn" title="Delete list">×</button>' : ''}
            <span class="list-count">${list.stations.length}</span>
          </div>
        </div>
      `;
      
      // Add click handler for switching lists (click on list name)
      const listName = listItem.querySelector('.list-name');
      listName.addEventListener('click', () => {
        if (list.id !== this.currentListId) {
          this.switchToList(list.id);
        }
        this.hideListDropdown();
      });
      
      // Add click handler for edit button
      const editBtn = listItem.querySelector('.list-edit-btn');
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent list switching
        this.editListName(list.id, list.name);
      });
      
      // Add click handler for export button
      const exportBtn = listItem.querySelector('.list-export-btn');
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent list switching
        this.exportList(list.id);
      });
      
      // Add click handler for remove button
      const removeBtn = listItem.querySelector('.list-remove-btn');
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent list switching
          this.confirmDeleteList(list.id, list.name);
        });
      }
      
      this.listItems.appendChild(listItem);
    });
  }
  
  toggleListDropdown() {
    const isOpen = this.listDropdownMenu.style.display === 'block';
    if (isOpen) {
      this.hideListDropdown();
    } else {
      this.showListDropdown();
    }
  }
  
  showListDropdown() {
    this.renderListDropdown();
    this.listDropdownMenu.style.display = 'block';
    this.listDropdownBtn.classList.add('open');
  }
  
  hideListDropdown() {
    this.listDropdownMenu.style.display = 'none';
    this.listDropdownBtn.classList.remove('open');
  }
  
  switchToList(listId) {
    if (this.stationLists[listId]) {
      this.currentListId = listId;
      this.syncLegacyFavorites();
      this.updateListUI();
      this.renderFavorites();
      this.saveData();
      this.notifyBackgroundFavoritesUpdate();
    }
  }
  
  showNewListModal() {
    this.hideListDropdown();
    this.newListModal.classList.add('show');
    this.newListNameInput.value = '';
    this.listNameError.style.display = 'none';
    // Remove auto-focus to prevent popup closing issues
    // setTimeout(() => this.newListNameInput.focus(), 100);
  }
  
  hideNewListModal() {
    this.newListModal.classList.remove('show');
  }
  
  showInfoModal() {
    this.infoModal.classList.add('show');
  }
  
  hideInfoModal() {
    this.infoModal.classList.remove('show');
  }
  
  showConfirmModal(title, message, onConfirm) {
    this.confirmTitle.textContent = title;
    this.confirmMessage.textContent = message;
    this.confirmModal.classList.add('show');
    
    // Remove any existing event listener to prevent multiple handlers
    this.confirmActionBtn.onclick = null;
    
    // Add the confirmation handler
    this.confirmActionBtn.onclick = () => {
      this.hideConfirmModal();
      if (onConfirm) onConfirm();
    };
  }
  
  hideConfirmModal() {
    this.confirmModal.classList.remove('show');
    this.confirmActionBtn.onclick = null;
  }
  
  showPromptModal(title, label, defaultValue, onConfirm) {
    this.promptTitle.textContent = title;
    this.promptLabel.textContent = label;
    this.promptInput.value = defaultValue || '';
    this.promptError.style.display = 'none';
    this.promptModal.classList.add('show');
    
    // Remove any existing event listener to prevent multiple handlers
    this.confirmPromptBtn.onclick = null;
    this.currentPromptHandler = onConfirm;
    
    // Add the confirmation handler
    this.confirmPromptBtn.onclick = () => this.handlePromptConfirm();
    
    // Focus the input after a short delay
    setTimeout(() => this.promptInput.focus(), 100);
  }
  
  hidePromptModal() {
    this.promptModal.classList.remove('show');
    this.confirmPromptBtn.onclick = null;
    this.currentPromptHandler = null;
    this.promptError.style.display = 'none';
  }
  
  handlePromptConfirm() {
    const value = this.promptInput.value.trim();
    
    if (this.currentPromptHandler) {
      const result = this.currentPromptHandler(value);
      // If handler returns false, keep modal open (validation failed)
      if (result !== false) {
        this.hidePromptModal();
      }
    }
  }
  
  createNewList() {
    const name = this.newListNameInput.value.trim();
    
    // Validation
    if (!name) {
      this.showListError('Please enter a list name');
      return;
    }
    
    if (name.length > 50) {
      this.showListError('List name too long (max 50 characters)');
      return;
    }
    
    // Check for duplicate names
    const existingNames = Object.values(this.stationLists).map(list => list.name.toLowerCase());
    if (existingNames.includes(name.toLowerCase())) {
      this.showListError('A list with this name already exists');
      return;
    }
    
    // Create new list
    const listId = 'list_' + Date.now();
    this.stationLists[listId] = {
      id: listId,
      name: name,
      stations: []
    };
    
    // Switch to new list and save
    this.switchToList(listId);
    this.hideNewListModal();
    this.showToast(`Created list "${name}"`, 'success');
  }
  
  showListError(message) {
    this.listNameError.textContent = message;
    this.listNameError.style.display = 'block';
  }
  
  confirmDeleteList(listId, listName) {
    const list = this.stationLists[listId];
    if (!list) return;
    
    // Don't allow deleting the favorites list
    if (listId === 'favorites') {
      this.showToast('Cannot delete the Favorites list', 'error');
      return;
    }
    
    // Don't allow deleting the only list
    if (Object.keys(this.stationLists).length <= 1) {
      this.showToast('Cannot delete the only remaining list', 'error');
      return;
    }
    
    const stationCount = list.stations.length;
    let confirmMessage = `Delete the list "${listName}"?`;
    if (stationCount > 0) {
      confirmMessage += `\n\nThis will permanently delete ${stationCount} station${stationCount === 1 ? '' : 's'}.`;
    }
    
    // Use custom modal instead of native confirm()
    this.showConfirmModal(
      'Delete List',
      confirmMessage,
      () => this.deleteList(listId, listName)
    );
  }
  
  deleteList(listId, listName) {
    // If we're deleting the current list, switch to favorites first
    if (this.currentListId === listId) {
      this.switchToList('favorites');
    }
    
    // Remove the list
    delete this.stationLists[listId];
    
    // Update UI and save
    this.updateListUI();
    this.saveData();
    this.notifyBackgroundFavoritesUpdate();
    this.hideListDropdown();
    
    this.showToast(`Deleted list "${listName}"`, 'success');
  }
  
  editListName(listId, currentName) {
    // Don't allow editing the favorites list name
    if (listId === 'favorites') {
      this.showToast('Cannot edit the Favorites list name', 'error');
      return;
    }
    
    const list = this.stationLists[listId];
    if (!list) return;
    
    // Use custom prompt modal instead of native prompt()
    this.showPromptModal(
      'Edit List Name',
      'List name:',
      currentName,
      (newName) => {
        // Validation
        if (!newName) {
          this.showPromptError('List name cannot be empty');
          return false; // Keep modal open
        }
        
        if (newName.length > 50) {
          this.showPromptError('List name too long (max 50 characters)');
          return false; // Keep modal open
        }
        
        // Check for duplicate names (excluding current list)
        const existingNames = Object.values(this.stationLists)
          .filter(l => l.id !== listId)
          .map(l => l.name.toLowerCase());
        if (existingNames.includes(newName.toLowerCase())) {
          this.showPromptError('A list with this name already exists');
          return false; // Keep modal open
        }
        
        // Update the list name
        this.stationLists[listId].name = newName;
        
        // Update UI and save
        this.updateListUI();
        this.renderListDropdown(); // Refresh dropdown to show new name
        this.saveData();
        this.notifyBackgroundFavoritesUpdate();
        
        this.showToast(`Renamed list to "${newName}"`, 'success');
        return true; // Close modal
      }
    );
  }
  
  showPromptError(message) {
    this.promptError.textContent = message;
    this.promptError.style.display = 'block';
  }

  // Helper function to notify background script about favorites changes
  notifyBackgroundFavoritesUpdate() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      // Send both legacy and new format for compatibility
      chrome.runtime.sendMessage({
        type: 'UPDATE_FAVORITES',
        favorites: this.favorites
      });
      
      chrome.runtime.sendMessage({
        type: 'UPDATE_CURRENT_LIST',
        stationLists: this.stationLists,
        currentListId: this.currentListId
      });
    }
  }

  async addCurrentStationToFavorites() {
    if (!this.currentStation) {
      this.showToast('No station selected', 'error');
      return;
    }
    
    // Check if station already exists in favorites
    const exists = this.favorites.some(fav => fav.id === this.currentStation.id);
    if (exists) {
      this.showToast(`Station already in ${this.getCurrentList().name}`, 'info');
      return;
    }
    
    // Add current station to current list
    const newStations = [...this.favorites, this.currentStation];
    this.updateCurrentList(newStations);
    
    // Update UI and save data
    this.renderFavorites();
    this.updatePlayerUI(); // This will hide the heart icon
    this.updateListUI(); // Update the list selector UI
    await this.saveData();
    
    // Notify background script
    this.notifyBackgroundFavoritesUpdate();
    
    this.showToast(`Station added to ${this.getCurrentList().name}`, 'success');
  }

  visitStationHomepage() {
    if (!this.currentStation || !this.currentStation.homepage) {
      this.showToast('No website available for this station', 'info');
      return;
    }
    
    // Open homepage in new tab
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: this.currentStation.homepage });
    } else {
      // Fallback for testing without extension context
      window.open(this.currentStation.homepage, '_blank');
    }
  }

  // Utility function to safely load favicons with error handling
  setupFaviconErrorHandling(container) {
    const images = container.querySelectorAll('.station-item-logo');
    images.forEach(img => {
      img.onerror = () => {
        const parent = img.parentElement;
        if (parent) {
          img.style.display = 'none';
          const initials = parent.querySelector('.station-item-initials');
          if (initials) {
            initials.style.display = 'flex';
          }
        }
      };
    });
  }

  // Utility function to validate and sanitize favicon URLs
  isValidFaviconUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    try {
      const urlObj = new URL(url);
      
      // Block font files that cause CORS issues (the original problem)
      const fontExtensions = ['.woff', '.woff2', '.ttf', '.otf', '.eot'];
      const pathname = urlObj.pathname.toLowerCase();
      
      // Check if it's a font file - block these to prevent CORS errors
      if (fontExtensions.some(ext => pathname.includes(ext))) {
        return false;
      }
      
      // Block obvious non-image files (but be more permissive than before)
      const bannedExtensions = ['.js', '.css', '.html', '.xml', '.pdf', '.zip'];
      if (bannedExtensions.some(ext => pathname.endsWith(ext))) {
        return false;
      }
      
      // Allow all other URLs - let the browser handle the image loading
      // If it fails, the onerror handler will show initials instead
      return true;
      
    } catch (e) {
      return false;
    }
  }
}

// Initialize the application
let app;

document.addEventListener('DOMContentLoaded', () => {
  try {
    app = new RadioDock();
  } catch (error) {
    console.error('Failed to initialize RadioDock app:', error);
    
    // Ensure player is at least visible even if there's an error
    const playerCard = document.getElementById('playerCard');
    if (playerCard) {
      playerCard.classList.add('loaded');
    }
  }
});
