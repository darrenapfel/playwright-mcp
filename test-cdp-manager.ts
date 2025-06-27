/**
 * Test script to verify CDPManager implementation
 */

import { chromium } from 'playwright';
import { CDPManager } from './src/browser/CDPManager.js';

async function testCDPManager() {
  console.log('Testing CDPManager implementation...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    // Create CDPManager instance
    const cdpManager = new CDPManager();
    console.log('✓ CDPManager created');
    
    // Attach to page
    const session = await cdpManager.attachToPage(page);
    console.log('✓ CDP session attached to page:', session.id);
    
    // Navigate to a test page
    await page.goto('https://example.com');
    console.log('✓ Navigated to example.com');
    
    // Wait a bit for events
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Get network data
    const networkData = await cdpManager.getNetworkData(page);
    console.log('✓ Network requests captured:', networkData.length);
    
    // Get console messages
    const consoleMessages = await cdpManager.getConsoleMessages(page);
    console.log('✓ Console messages captured:', consoleMessages.length);
    
    // Test CDP command
    const title = await session.evaluate('document.title');
    console.log('✓ Page title via CDP:', title);
    
    // Get metrics
    const metrics = await session.getMetrics();
    console.log('✓ Performance metrics:', metrics.length);
    
    // Test cleanup
    await cdpManager.closeAll();
    console.log('✓ All sessions closed');
    
    console.log('\n✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

// Run the test
testCDPManager().catch(console.error);