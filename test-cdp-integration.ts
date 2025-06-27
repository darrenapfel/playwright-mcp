/**
 * Test CDP integration with Playwright MCP
 * 
 * This test verifies that CDP sessions are automatically attached when pages are created
 */

import { chromium } from 'playwright';
import { createConnection, cdpManager } from './src/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function testCDPIntegration() {
  console.log('Starting CDP integration test...\n');
  
  try {
    // Create a connection with a test config
    const connection = await createConnection({
      browser: {
        browserName: 'chromium',
        launchOptions: {
          headless: true
        }
      }
    });
    
    console.log('✓ Connection created');
    
    // Get the context from connection
    const context = connection.context;
    console.log('✓ Got context from connection');
    
    // Create a new tab/page
    await context.newTab();
    console.log('✓ New tab created');
    
    // Get the current tab
    const currentTab = context.currentTabOrDie();
    const page = currentTab.page;
    console.log('✓ Got page from tab');
    
    // Check if CDP session was attached
    const cdpSession = cdpManager.getSession(page);
    if (cdpSession) {
      console.log('✓ CDP session automatically attached to page');
      console.log(`  Session ID: ${cdpSession.id}`);
      
      // Test CDP functionality
      const metrics = await cdpSession.getMetrics();
      console.log('✓ CDP metrics retrieved:', metrics.length, 'metrics');
      
      // Test network capture
      await page.goto('https://example.com');
      const networkRequests = await cdpManager.getNetworkData(page);
      console.log('✓ Network requests captured:', networkRequests.length, 'requests');
      
      // Test console messages
      await page.evaluate(() => console.log('Test message from page'));
      const consoleMessages = await cdpManager.getConsoleMessages(page);
      console.log('✓ Console messages captured:', consoleMessages.length, 'messages');
      
    } else {
      console.error('✗ CDP session was not attached to page');
      process.exit(1);
    }
    
    // Test cleanup
    await page.close();
    console.log('✓ Page closed');
    
    // Verify CDP session was cleaned up
    const sessionAfterClose = cdpManager.getSession(page);
    if (!sessionAfterClose) {
      console.log('✓ CDP session properly cleaned up after page close');
    } else {
      console.error('✗ CDP session was not cleaned up');
      process.exit(1);
    }
    
    // Close the connection
    await connection.close();
    console.log('✓ Connection closed');
    
    console.log('\n✅ All CDP integration tests passed!');
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testCDPIntegration();