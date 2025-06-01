# StableQueue Changelog - May 30, 2025

This document records the significant changes, improvements, and fixes made to StableQueue on May 30, 2025.

## Summary

Today's work focused on simplifying the codebase by removing unnecessary complexity, fixing critical API key management issues, and improving cross-origin support for browser extensions.

## Major Changes

### 🗑️ Removed Features

#### 1. Model Root Path Functionality
**Rationale**: Overly complex Windows/Linux path detection was unnecessary and error-prone.

**Files Modified**:
- `routes/servers.js` - Removed `modelRootPath` from POST/PUT endpoints
- `services/gradioJobDispatcher.js` - Removed path detection logic, now uses forward slashes consistently
- `public/index.html` - Removed "Model Root Path" field from Server Setup form
- `public/js/app.js` - Removed form field handling for model root path

**Impact**: Simplified server configuration and eliminated platform-specific complexity.

#### 2. API Key Tier System
**Rationale**: Tier system (standard/premium) added unnecessary complexity without clear benefit.

**Files Modified**:
- `routes/apiKeys.js` - Removed tier references from all endpoints
- `public/js/apiKeyManager.js` - Removed tier dropdown and handling
- `public/index.html` - Removed tier selection from API key forms
- `utils/apiKeyManager.js` - Simplified to single rate limit

**Impact**: Streamlined API key creation and management, all keys now have consistent 60 req/min rate limit.

### 🐛 Critical Bug Fixes

#### 1. API Key Management Authentication Issue
**Problem**: Web UI required API key authentication to manage API keys (chicken-and-egg problem).

**Solution**: Distinguished between administrative access (web UI) and programmatic access (external apps).

**Files Modified**:
- `routes/apiKeys.js` - Removed authentication requirement for web UI endpoints
- `middleware/apiMiddleware.js` - Added CORS middleware for cross-origin requests

**Impact**: Web UI can now manage API keys without authentication, while external apps still require API keys.

#### 2. API Endpoint URL Inconsistency
**Problem**: Frontend called `/api/v1/apikeys/` but backend used `/api/v1/api-keys/`.

**Solution**: Standardized on `/api/v1/api-keys/` format throughout.

**Files Modified**:
- `public/js/apiKeyManager.js` - Updated all endpoint URLs to use dash format

**Impact**: API key details, edit, and delete functions now work properly.

#### 3. Response Data Structure Mismatch
**Problem**: Backend returned nested `{api_key: {...}}` but frontend expected direct data.

**Solution**: Updated frontend to handle both formats with fallback.

**Files Modified**:
- `public/js/apiKeyManager.js` - Added `responseData.api_key || responseData` pattern

**Impact**: API key edit forms now populate correctly with existing data.

### ✨ New Features

#### 1. First-Time Setup Flow
**Purpose**: Provide smooth onboarding experience for new installations.

**Implementation**:
- `GET /api/v1/api-keys/setup` - Check if any API keys exist
- `POST /api/v1/api-keys/setup` - Create first key without authentication
- Frontend automatically detects and handles first-time setup

**Files Added/Modified**:
- `routes/apiKeys.js` - Added setup endpoints
- `public/js/apiKeyManager.js` - Added setup flow logic

#### 2. CORS Support
**Purpose**: Enable browser-based extensions to communicate with StableQueue.

**Implementation**:
- Added middleware to handle cross-origin requests
- Support for localhost ports: 7860, 8080, 3000
- Proper preflight OPTIONS request handling

**Files Added/Modified**:
- `middleware/apiMiddleware.js` - New CORS middleware
- `app.js` - Integrated CORS middleware into all routes

#### 3. Enhanced Error Handling
**Purpose**: Provide better user experience and debugging information.

**Implementation**:
- Standardized error response format across all endpoints
- Context-aware error messages
- Graceful fallbacks for edge cases

**Files Modified**:
- `public/js/apiKeyManager.js` - Improved error handling and user feedback
- `routes/apiKeys.js` - Consistent error response format

### 🔧 Technical Improvements

#### 1. Database Cleanup Commands
Added tooling to safely clear API keys for testing:
```bash
# Clear API keys from containerized database
ssh root@192.168.73.124 "docker exec stablequeue node -e \"...\""
```

#### 2. Code Simplification
- Removed unused variables and functions
- Consolidated similar logic patterns
- Eliminated dead code paths

#### 3. Documentation Updates
Updated comprehensive documentation across multiple files:
- `docs/API_KEY_UI_SUMMARY.md` - Reflected current implementation
- `docs/API_IMPLEMENTATION_SUMMARY.md` - Added recent changes and fixes
- `docs/EXTENSION_API.md` - Updated for new authentication model
- `docs/API.md` - Added API key management endpoints
- `docs/FILES.MD` - Updated file structure and architecture overview

## Deployment

All changes were deployed to the Unraid server at `192.168.73.124:8083` using the automated deployment script:
```bash
./deploy-stablequeue-to-unraid.sh
```

## Testing Results

### ✅ Working Features
- API key creation and management through web UI
- Cross-origin requests from Forge extensions
- Server configuration without model root path
- First-time setup flow for new installations

### 📋 Verified Functionality
- API key details modal displays correctly
- Edit form populates with existing values
- Delete confirmation works properly
- Copy to clipboard functionality
- Rate limiting enforcement

## Database Changes

### Schema Impact
- API keys table uses existing structure (no schema changes)
- Removed tier-related logic but kept tier column for backward compatibility
- All API keys default to standard rate limit (60 req/min)

### Data Migration
- Existing API keys continue to work normally
- No data loss or corruption during updates
- Smooth transition for existing installations

## Configuration Changes

### Server Setup Simplified
**Before**:
```json
{
  "alias": "Server1",
  "host": "192.168.1.100", 
  "port": 7860,
  "modelRootPath": "/path/to/models"  // ❌ Removed
}
```

**After**:
```json
{
  "alias": "Server1",
  "host": "192.168.1.100",
  "port": 7860
}
```

### API Key Management Simplified
**Before**: Required API key to view existing API keys
**After**: Web UI has administrative access without authentication

## Performance Impact

### Positive Changes
- ✅ Reduced complexity in server configuration
- ✅ Faster API key management operations
- ✅ Eliminated unnecessary path detection logic
- ✅ Streamlined authentication flow

### No Performance Regression
- ⏱️ Job processing speed unchanged
- ⏱️ Database operations remain efficient
- ⏱️ Memory usage unaffected

## Security Considerations

### Authentication Model
- **Web UI**: Administrative access without API key authentication
- **External Apps**: Must authenticate with API keys
- **Security**: Web UI should be secured at network/application level

### CORS Security
- Limited to specific localhost ports
- Proper preflight request validation
- No wildcard origins allowed

## Future Considerations

### Recommended Next Steps
1. **Extension Development**: Use the simplified API key flow for Forge extension
2. **Rate Limiting**: Consider configurable rate limits per key if needed
3. **Audit Logging**: Add comprehensive logging for API key operations
4. **IP Restrictions**: Consider adding IP allowlists for API keys

### Potential Enhancements
- Bulk API key operations
- Usage analytics dashboard
- API key expiration dates
- Advanced permissions system

## Files Changed Summary

### Backend Changes
- `routes/servers.js` - Removed model root path handling
- `routes/apiKeys.js` - Fixed authentication model and endpoint consistency
- `services/gradioJobDispatcher.js` - Simplified path handling
- `middleware/apiMiddleware.js` - Added CORS support
- `app.js` - Integrated new middleware

### Frontend Changes
- `public/js/apiKeyManager.js` - Fixed endpoint URLs and data handling
- `public/index.html` - Removed model root path and tier fields
- `public/js/app.js` - Removed obsolete form handling

### Documentation Changes
- `docs/API_KEY_UI_SUMMARY.md` - Updated implementation details
- `docs/API_IMPLEMENTATION_SUMMARY.md` - Added recent changes
- `docs/EXTENSION_API.md` - Updated authentication model
- `docs/API.md` - Added API key management endpoints
- `docs/FILES.MD` - Updated architecture overview

## Lessons Learned

1. **Simplicity**: Removing unnecessary features improved maintainability
2. **Authentication**: Clear separation between admin UI and programmatic access
3. **Testing**: Database cleanup tools essential for development
4. **Documentation**: Comprehensive docs critical for complex changes

---

*This changelog documents the work completed on May 30, 2025, to improve StableQueue's reliability, usability, and maintainability.* 