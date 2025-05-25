# StableQueue API Testing Summary

This document summarizes the API testing strategy and tools implemented for the StableQueue project, with a focus on the v2 API endpoints designed for extension support.

## Testing Approach

The API testing approach includes three main components:

1. **Automated Unit Tests** - Programmatic tests that verify API functionality
2. **Manual Interactive Tests** - Guided tests with detailed output for debugging
3. **Postman Collection** - Documentation and example requests for reference

## 1. Automated Tests

The automated tests (`tests/apiEndpoints.test.js`) focus on verifying that the API endpoints work correctly in various scenarios. These tests:

- Create temporary API keys for testing and clean up afterward
- Test API authentication with valid, invalid, and missing keys
- Verify job submission via the v2 endpoint
- Test job status retrieval with proper field validation
- Confirm job filtering by app_type works correctly
- Verify error responses for invalid inputs
- Validate that jobs can be canceled

The automated tests can be run with:
```
npm run test:api
```

For more detailed output:
```
npm run test:api:verbose
```

## 2. Manual Interactive Tests

The manual tests (`scripts/manualApiTests.js`) provide a guided, interactive experience with detailed output. These tests:

- Allow for step-by-step verification of API functionality
- Display detailed information about requests and responses
- Pause for user inspection at key points
- Provide clear success/failure indicators
- Clean up test resources automatically

The manual tests can be run with:
```
npm run test:api:manual
```

## 3. Postman Collection

The Postman collection (`docs/postman/stablequeue_api_collection.json`) serves as both documentation and a tool for ad-hoc testing. It includes:

- Pre-configured requests for all API endpoints
- Example request bodies with realistic values
- Variable placeholders for easy customization
- Descriptive names and documentation for each endpoint

## Test Coverage

The API tests cover:

### Authentication System
- API key creation, listing, retrieval, updating, and deletion
- Authentication with valid and invalid API keys
- Testing missing authentication
- Verification of rate limiting (in automated tests)

### Job Management
- Job submission with all required parameters
- Verification of app_type and source_info field handling
- Job status retrieval with extension-specific fields
- Job filtering by app_type and other criteria
- Job cancellation functionality

### Error Handling
- Testing of validation errors (missing fields, invalid values)
- Verification of proper error codes and messages
- Testing error responses for non-existent resources
- Authentication error handling

## Next Steps

With the API testing framework in place, the following steps are recommended:

1. **Create a UI for API Key Management** - This is the next priority task according to the task list
2. **Begin Forge Extension Development** - Using the tested API endpoints as a foundation
3. **Ongoing Testing** - Add tests for new functionality as it's developed
4. **Integration Testing** - Once the Forge extension is created, test the full flow from extension to StableQueue and back 