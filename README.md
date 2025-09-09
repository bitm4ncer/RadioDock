# Radio Dock

A clean and intuitive Chrome extension for discovering, playing, and managing radio stations from around the world.

![Radio Dock](logo/icon-128.png)

## Features

### **Seamless Radio Playback**
- Background audio playback that continues even when the popup is closed
- Integrated volume control with 5-level visual indicators (20%, 40%, 60%, 80%, 100%)
- High-quality streaming from thousands of radio stations worldwide
- Visual playback indicators and smooth controls
- Real-time "Now Playing" metadata display with scrolling text for long titles

### **Station Discovery**
- Search stations by name, genre, or country with smart filters
- Results ordered by popularity (clickcount) for best recommendations
- Powered by the [Radio Browser](https://www.radio-browser.info) community database
- Access to over 50,000 verified radio stations globally including community radios

### **Smart Organization**
- Create and manage multiple custom station lists
- Active list always appears first in dropdown for quick access
- Drag-and-drop reordering for perfect organization
- Import/export functionality for backup and sharing
- Station list names can be edited in-place

### **Modern Interface**
- Clean, dark-themed popup design with subtle shadow effects
- Smooth animations and intuitive navigation
- Responsive layout optimized for quick access
- Station logos with fallback initials for visual identification
- Context menu integration for quick station controls

### **Advanced Features**
- Smart metadata fetching from multiple sources (ICY, NTS Radio API, HLS streams)
- Automatic station change detection and state management
- Error handling with graceful fallbacks for failed streams
- Cross-device synchronization via Chrome storage sync
- Comprehensive station information display (country, homepage links)

## Installation

### From Chrome Web Store
1. Visit the Chrome Web Store (link coming soon)
2. Click "Add to Chrome"
3. Click "Add Extension" to confirm

### Manual Installation (Developer Mode)
1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The Radio Dock icon will appear in your browser toolbar

## How to Use

### Getting Started
1. Click the Radio Dock icon in your browser toolbar
2. Use the search bar to find radio stations
3. Click on any station to start playing
4. Add stations to your favorites by clicking the heart icon

### Managing Station Lists
- **Create Lists**: Click the dropdown next to "Radio Dock" → "New List"
- **Switch Lists**: Use the dropdown to switch between different station collections
- **Reorder Stations**: Drag the handle (≡) icon to reorder stations within a list
- **Import/Export**: Share your station lists or backup your favorites

### Playback Controls
- **Play/Pause**: Click the center play button with visual state indicators
- **Volume Control**: 5-dot volume indicator (20%-100%) with clickable controls
- **Station Info**: View current station name, country, and "Now Playing" metadata
- **Background Play**: Audio continues when popup is closed
- **Quick Access**: Stations remember their playing state
- **Smart Buffering**: Visual loading indicators during stream connection

## Technical Details

### Built With
- **Manifest V3**: Latest Chrome extension standard
- **Modern Web APIs**: Service Workers, Offscreen API
- **Responsive Design**: CSS Grid/Flexbox with modern styling
- **Radio Browser API**: Community-driven station database

### Permissions Used
- **Storage**: Save your favorite stations and preferences locally
- **Offscreen**: Enable background audio playback (Manifest V3 requirement)
- **Host Permissions**: Access Radio Browser API for station data

### Architecture
- **Background Service Worker**: Manages audio playback and state
- **Popup Interface**: Main user interface for station management
- **Offscreen Document**: Dedicated audio playback context
- **Local Storage**: Persistent data with Chrome sync backup

## Privacy & Data

Radio Dock respects your privacy:
- **No tracking**: We don't collect or track any personal data
- **Local storage only**: All preferences stored locally on your device
- **No external analytics**: No third-party tracking services
- **Open source**: Transparent code you can inspect

## API Integration

This extension uses the [Radio Browser API](https://www.radio-browser.info), a community-driven database of radio stations:
- **Free and open**: Community-maintained station database
- **Global coverage**: Stations from every continent
- **Real-time updates**: Continuously updated by volunteers
- **High quality**: Verified and moderated station data

## Support

### Feedback & Issues
- **Bug Reports**: [GitHub Issues](https://github.com/your-repo/radio-dock/issues)
- **Feature Requests**: Submit via GitHub Issues
- **General Support**: Contact via Chrome Web Store

### Contributing
We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request with detailed description

### Buy Me a Coffee
If you enjoy Radio Dock, consider supporting development:
[Buy me a coffee](https://buymeacoffee.com/bitmancer)

## Version History

### Version 1.0
- Initial release with comprehensive feature set
- Station search and playbook with popularity-based ordering
- Advanced favorites management with multiple custom lists
- Background audio support with volume control (5-level indicators)
- Real-time "Now Playing" metadata from multiple sources
- Drag-and-drop reordering within station lists
- Import/export functionality for backup and sharing
- Smart station list management (active list appears first)
- Context menu integration for quick controls
- Cross-device synchronization via Chrome storage sync
- Comprehensive error handling and graceful fallbacks

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- **Radio Browser Community**: For maintaining the amazing station database
- **Chrome Extensions Team**: For the robust Manifest V3 platform
- **Open Source Community**: For inspiration and best practices

---

**Radio Dock** - Bringing the world's radio stations to your browser toolbar.