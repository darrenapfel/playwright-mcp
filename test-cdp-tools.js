/**
 * Validation script for CDP tools
 * Tests cdp_execute_script and cdp_network_capture on real websites
 */
import { chromium } from 'playwright';
import { cdpManager } from './src/browser/CDPManager.js';
async function testCDPExecuteScript(page) {
    console.log('\n=== Testing cdp_execute_script ===');
    const session = await cdpManager.attachToPage(page);
    // Test 1: Extract DOM data
    console.log('\nTest 1: Extracting DOM data from the page...');
    const domResult = await session.send('Runtime.evaluate', {
        expression: `
      (() => {
        const data = {
          title: document.title,
          url: window.location.href,
          bodyText: document.body.innerText.substring(0, 200),
          linkCount: document.querySelectorAll('a').length,
          imageCount: document.querySelectorAll('img').length,
          scriptCount: document.querySelectorAll('script').length,
          metaTags: Array.from(document.querySelectorAll('meta')).slice(0, 5).map(m => ({
            name: m.getAttribute('name'),
            content: m.getAttribute('content')?.substring(0, 100)
          }))
        };
        return data;
      })()
    `,
        awaitPromise: true,
        returnByValue: true
    });
    if (domResult.exceptionDetails) {
        console.error('DOM extraction failed:', domResult.exceptionDetails);
    }
    else {
        console.log('DOM Data extracted:', JSON.stringify(domResult.result.value, null, 2));
    }
    // Test 2: Execute async code
    console.log('\nTest 2: Testing async code execution...');
    const asyncResult = await session.send('Runtime.evaluate', {
        expression: `
      (async () => {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        await delay(100);
        return {
          timestamp: Date.now(),
          userAgent: navigator.userAgent,
          viewport: {
            width: window.innerWidth,
            height: window.innerHeight
          }
        };
      })()
    `,
        awaitPromise: true,
        returnByValue: true
    });
    if (asyncResult.exceptionDetails) {
        console.error('Async execution failed:', asyncResult.exceptionDetails);
    }
    else {
        console.log('Async result:', JSON.stringify(asyncResult.result.value, null, 2));
    }
}
async function testCDPNetworkCapture(page) {
    console.log('\n=== Testing cdp_network_capture ===');
    const session = await cdpManager.attachToPage(page);
    // Clear any previous data
    await cdpManager.detachFromPage(page);
    await cdpManager.attachToPage(page);
    console.log('\nStarting network capture...');
    // Navigate to TheVerge.com
    console.log('Navigating to TheVerge.com...');
    await page.goto('https://www.theverge.com', { waitUntil: 'networkidle' });
    // Wait a bit for more requests
    await page.waitForTimeout(3000);
    // Get network data
    const networkRequests = session.getNetworkRequests();
    console.log(`\nTotal requests captured: ${networkRequests.length}`);
    // Analyze requests
    const summary = {
        totalRequests: networkRequests.length,
        requestsWithBodies: 0,
        requestsByType: {},
        requestsByDomain: {},
        largestResponses: []
    };
    networkRequests.forEach(req => {
        // Count by type
        const type = req.type || 'Unknown';
        summary.requestsByType[type] = (summary.requestsByType[type] || 0) + 1;
        // Count requests with bodies
        if (req.responseBody) {
            summary.requestsWithBodies++;
        }
        // Count by domain
        try {
            const url = new URL(req.url);
            const domain = url.hostname;
            summary.requestsByDomain[domain] = (summary.requestsByDomain[domain] || 0) + 1;
        }
        catch { }
        // Track largest responses
        if (req.responseBody) {
            summary.largestResponses.push({
                url: req.url,
                size: req.responseBody.length,
                type: req.type,
                mimeType: req.response?.mimeType
            });
        }
    });
    // Sort largest responses
    summary.largestResponses.sort((a, b) => b.size - a.size);
    summary.largestResponses = summary.largestResponses.slice(0, 10);
    console.log('\nNetwork Capture Summary:');
    console.log(`- Total requests: ${summary.totalRequests}`);
    console.log(`- Requests with captured bodies: ${summary.requestsWithBodies}`);
    console.log('\nRequests by type:');
    Object.entries(summary.requestsByType).forEach(([type, count]) => {
        console.log(`  - ${type}: ${count}`);
    });
    console.log('\nTop domains:');
    const topDomains = Object.entries(summary.requestsByDomain)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10);
    topDomains.forEach(([domain, count]) => {
        console.log(`  - ${domain}: ${count} requests`);
    });
    console.log('\nLargest captured responses:');
    summary.largestResponses.forEach(res => {
        console.log(`  - ${res.url.substring(0, 80)}... (${(res.size / 1024).toFixed(1)}KB, ${res.type})`);
    });
    // Show sample of captured body
    const sampleRequest = networkRequests.find(r => r.responseBody && r.response?.mimeType?.includes('json'));
    if (sampleRequest) {
        console.log('\nSample captured JSON response:');
        console.log(`URL: ${sampleRequest.url}`);
        console.log(`Body preview: ${sampleRequest.responseBody.substring(0, 200)}...`);
    }
    return summary;
}
async function main() {
    console.log('CDP Tools Validation Script');
    console.log('==========================');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    try {
        // Attach CDP to context
        await cdpManager.attachToContext(context);
        // Test 1: cdp_execute_script on a simple page
        console.log('\n--- Test 1: cdp_execute_script on example.com ---');
        const page1 = await context.newPage();
        await page1.goto('https://example.com');
        await testCDPExecuteScript(page1);
        await page1.close();
        // Test 2: cdp_network_capture on TheVerge.com
        console.log('\n--- Test 2: cdp_network_capture on TheVerge.com ---');
        const page2 = await context.newPage();
        const networkSummary = await testCDPNetworkCapture(page2);
        // Validate results
        console.log('\n=== Validation Results ===');
        const validationPassed = networkSummary.totalRequests >= 50 && networkSummary.requestsWithBodies > 0;
        if (validationPassed) {
            console.log('✅ VALIDATION PASSED!');
            console.log(`   - Captured ${networkSummary.totalRequests} network requests (>= 50 required)`);
            console.log(`   - Captured ${networkSummary.requestsWithBodies} response bodies`);
        }
        else {
            console.log('❌ VALIDATION FAILED!');
            console.log(`   - Only captured ${networkSummary.totalRequests} requests (needed >= 50)`);
            console.log(`   - Only captured ${networkSummary.requestsWithBodies} response bodies`);
        }
        await page2.close();
    }
    catch (error) {
        console.error('Error during validation:', error);
    }
    finally {
        await cdpManager.closeAll();
        await browser.close();
    }
}
// Run the validation
main().catch(console.error);
