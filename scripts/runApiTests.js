/**
 * runApiTests.js
 * Script to run API endpoint tests
 */

const apiTests = require('../tests/apiEndpoints.test');

console.log('MobileSD API Endpoint Test Runner');
console.log('================================');
console.log('');

apiTests.runTests()
    .then(() => {
        console.log('Test run completed.');
    })
    .catch(err => {
        console.error('Test run failed:', err);
        process.exit(1);
    }); 