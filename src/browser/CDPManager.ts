/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { BrowserContext, Page, CDPSession as PlaywrightCDPSession } from 'playwright';
import { EventEmitter } from 'events';
import type { CDPEvent, CDPError } from '../cdp/types.js';

/**
 * Required CDP domains for comprehensive page analysis
 * Order matters - some domains depend on others
 */
const REQUIRED_DOMAINS = [
  'Runtime',     // Must be first
  'Network',
  'Page',
  'DOM',         // Must be before CSS
  'CSS',         // Depends on DOM
  'Console',
  'Performance',
  'Security',
  'Fetch'
] as const;

type CDPDomain = typeof REQUIRED_DOMAINS[number];

/**
 * CDP event types we care about
 */
interface CDPEventHandlers {
  'Network.requestWillBeSent': (params: any) => void;
  'Network.responseReceived': (params: any) => void;
  'Network.loadingFinished': (params: any) => void;
  'Network.loadingFailed': (params: any) => void;
  'Console.messageAdded': (params: any) => void;
  'Runtime.consoleAPICalled': (params: any) => void;
  'Runtime.exceptionThrown': (params: any) => void;
  'DOM.documentUpdated': () => void;
  'DOM.childNodeInserted': (params: any) => void;
  'DOM.childNodeRemoved': (params: any) => void;
  'DOM.attributeModified': (params: any) => void;
  'CSS.styleSheetAdded': (params: any) => void;
  'CSS.styleSheetChanged': (params: any) => void;
  'CSS.styleSheetRemoved': (params: any) => void;
  'Page.frameAttached': (params: any) => void;
  'Page.frameDetached': (params: any) => void;
  'Page.frameNavigated': (params: any) => void;
  'Page.domContentEventFired': (params: any) => void;
  'Page.loadEventFired': (params: any) => void;
}

/**
 * CDPManager - Manages Chrome DevTools Protocol connections for pages and contexts
 * 
 * Provides automatic CDP session attachment, domain enabling, and event forwarding
 * for comprehensive page analysis and debugging capabilities.
 */
export class CDPManager extends EventEmitter {
  private sessions = new Map<string, CDPSession>();
  private pageToSessionMap = new WeakMap<Page, CDPSession>();
  private contextPages = new WeakMap<BrowserContext, Set<Page>>();

  constructor() {
    super();
  }

  /**
   * Attach CDP to a browser context and all its pages
   */
  async attachToContext(context: BrowserContext): Promise<void> {
    // Track pages for this context
    const pages = new Set<Page>();
    this.contextPages.set(context, pages);

    // Attach to existing pages
    for (const page of context.pages()) {
      await this.attachToPage(page);
      pages.add(page);
    }

    // Listen for new pages
    context.on('page', async (page) => {
      pages.add(page);
      await this.attachToPage(page);
    });
  }

  /**
   * Attach CDP to a specific page
   */
  async attachToPage(page: Page): Promise<CDPSession> {
    // Check if already attached
    const existing = this.pageToSessionMap.get(page);
    if (existing && !existing.isClosed()) {
      return existing;
    }

    try {
      // Create CDP session through Playwright
      const client = await page.context().newCDPSession(page);
      
      // Wrap in our CDPSession
      const session = new CDPSession(page, client);
      
      // Store mappings
      this.sessions.set(session.id, session);
      this.pageToSessionMap.set(page, session);

      // Initialize session
      await session.initialize();

      // Forward events
      this.setupEventForwarding(session);

      // Cleanup on page close
      page.once('close', () => {
        this.detachFromPage(page);
      });

      this.emit('sessionCreated', { sessionId: session.id, page });
      
      return session;
    } catch (error) {
      console.error('Failed to attach CDP to page:', error);
      throw error;
    }
  }

  /**
   * Detach CDP from a page
   */
  async detachFromPage(page: Page): Promise<void> {
    const session = this.pageToSessionMap.get(page);
    if (session) {
      await session.close();
      this.sessions.delete(session.id);
      this.pageToSessionMap.delete(page);
      this.emit('sessionClosed', { sessionId: session.id });
    }
  }

  /**
   * Get CDP session for a page
   */
  getSession(page: Page): CDPSession | undefined {
    return this.pageToSessionMap.get(page);
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: string): CDPSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Setup event forwarding from CDP session
   */
  private setupEventForwarding(session: CDPSession): void {
    // Network events
    session.on('Network.requestWillBeSent', (params) => {
      this.emit('networkRequest', { sessionId: session.id, ...params });
    });

    session.on('Network.responseReceived', (params) => {
      this.emit('networkResponse', { sessionId: session.id, ...params });
    });

    session.on('Network.loadingFinished', (params) => {
      this.emit('networkLoadingFinished', { sessionId: session.id, ...params });
    });

    // Console events
    session.on('Console.messageAdded', (params) => {
      this.emit('consoleMessage', { sessionId: session.id, ...params });
    });

    session.on('Runtime.consoleAPICalled', (params) => {
      this.emit('consoleAPI', { sessionId: session.id, ...params });
    });

    session.on('Runtime.exceptionThrown', (params) => {
      this.emit('exception', { sessionId: session.id, ...params });
    });

    // DOM events
    session.on('DOM.documentUpdated', () => {
      this.emit('domUpdated', { sessionId: session.id });
    });

    session.on('DOM.childNodeInserted', (params) => {
      this.emit('domNodeInserted', { sessionId: session.id, ...params });
    });

    session.on('DOM.childNodeRemoved', (params) => {
      this.emit('domNodeRemoved', { sessionId: session.id, ...params });
    });

    // Page lifecycle events
    session.on('Page.domContentEventFired', (params) => {
      this.emit('domContentLoaded', { sessionId: session.id, ...params });
    });

    session.on('Page.loadEventFired', (params) => {
      this.emit('pageLoaded', { sessionId: session.id, ...params });
    });
  }

  /**
   * Execute CDP command on a specific page
   */
  async sendCommand(page: Page, method: string, params?: any): Promise<any> {
    const session = await this.attachToPage(page);
    return session.send(method, params);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): CDPSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Close all CDP sessions
   */
  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.sessions.values()).map(session => 
      session.close().catch(err => console.error('Error closing session:', err))
    );
    
    await Promise.all(closePromises);
    
    this.sessions.clear();
    this.removeAllListeners();
  }

  /**
   * Get network data for a page
   */
  async getNetworkData(page: Page): Promise<any[]> {
    const session = this.getSession(page);
    if (!session) {
      return [];
    }
    return session.getNetworkRequests();
  }

  /**
   * Get console messages for a page
   */
  async getConsoleMessages(page: Page): Promise<any[]> {
    const session = this.getSession(page);
    if (!session) {
      return [];
    }
    return session.getConsoleMessages();
  }
}

/**
 * CDPSession - Wraps a Playwright CDP session with additional functionality
 */
export class CDPSession extends EventEmitter {
  readonly id: string;
  private page: Page;
  private client: PlaywrightCDPSession;
  private closed = false;
  private networkRequests: Map<string, any> = new Map();
  private consoleMessages: any[] = [];
  private responseBodyCache: Map<string, string> = new Map();
  private eventHandlers: Map<string, Function> = new Map();

  constructor(page: Page, client: PlaywrightCDPSession) {
    super();
    this.page = page;
    this.client = client;
    this.id = `cdp-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Initialize the CDP session
   */
  async initialize(): Promise<void> {
    try {
      // Enable required domains
      for (const domain of REQUIRED_DOMAINS) {
        await this.enableDomain(domain);
      }

      // Setup event listeners
      this.setupEventListeners();

      // Configure network to capture response bodies
      await this.send('Network.setCacheDisabled', { cacheDisabled: true });
      await this.send('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Response' }]
      });

    } catch (error) {
      console.error('Failed to initialize CDP session:', error);
      throw error;
    }
  }

  /**
   * Enable a CDP domain
   */
  private async enableDomain(domain: CDPDomain): Promise<void> {
    try {
      await this.send(`${domain}.enable`);
    } catch (error) {
      // Some domains might not be available in all contexts, continue anyway
      if (domain !== 'Runtime' && domain !== 'Network' && domain !== 'Page') {
        // Only warn for non-critical domains
        console.warn(`Failed to enable domain ${domain}:`, error);
      } else {
        // Re-throw for critical domains
        throw error;
      }
    }
  }

  /**
   * Setup CDP event listeners
   */
  private setupEventListeners(): void {
    // Network events
    this.client.on('Network.requestWillBeSent', (params) => {
      this.networkRequests.set(params.requestId, {
        requestId: params.requestId,
        url: params.request.url,
        method: params.request.method,
        headers: params.request.headers,
        timestamp: params.timestamp,
        type: params.type,
        initiator: params.initiator
      });
      this.emit('Network.requestWillBeSent', params);
    });

    this.client.on('Network.responseReceived', (params) => {
      const request = this.networkRequests.get(params.requestId);
      if (request) {
        request.response = {
          status: params.response.status,
          statusText: params.response.statusText,
          headers: params.response.headers,
          mimeType: params.response.mimeType,
          timestamp: params.timestamp
        };
      }
      this.emit('Network.responseReceived', params);
    });

    this.client.on('Network.loadingFinished', async (params) => {
      // Try to get response body
      try {
        const response = await this.send('Network.getResponseBody', { 
          requestId: params.requestId 
        });
        if (response.body) {
          this.responseBodyCache.set(params.requestId, response.body);
          const request = this.networkRequests.get(params.requestId);
          if (request) {
            request.responseBody = response.body;
          }
        }
      } catch (error) {
        // Body might not be available for all requests
      }
      this.emit('Network.loadingFinished', params);
    });

    // Console events
    this.client.on('Console.messageAdded', (params) => {
      this.consoleMessages.push({
        ...params.message,
        timestamp: Date.now()
      });
      this.emit('Console.messageAdded', params);
    });

    this.client.on('Runtime.consoleAPICalled', (params) => {
      this.consoleMessages.push({
        type: params.type,
        args: params.args,
        timestamp: params.timestamp,
        stackTrace: params.stackTrace
      });
      this.emit('Runtime.consoleAPICalled', params);
    });

    // DOM events
    this.client.on('DOM.documentUpdated', () => {
      this.emit('DOM.documentUpdated');
    });

    this.client.on('DOM.childNodeInserted', (params) => {
      this.emit('DOM.childNodeInserted', params);
    });

    this.client.on('DOM.childNodeRemoved', (params) => {
      this.emit('DOM.childNodeRemoved', params);
    });

    // Page lifecycle
    this.client.on('Page.domContentEventFired', (params) => {
      this.emit('Page.domContentEventFired', params);
    });

    this.client.on('Page.loadEventFired', (params) => {
      this.emit('Page.loadEventFired', params);
    });

    // Fetch events for response interception
    this.client.on('Fetch.requestPaused', async (params) => {
      try {
        // Get response body if available
        if (params.responseStatusCode) {
          const response = await this.send('Fetch.getResponseBody', {
            requestId: params.requestId
          });
          if (response.body) {
            this.responseBodyCache.set(params.networkId || params.requestId, response.body);
          }
        }
        
        // Continue the request
        await this.send('Fetch.continueRequest', {
          requestId: params.requestId
        });
      } catch (error) {
        console.error('Error handling Fetch.requestPaused:', error);
      }
    });
  }

  /**
   * Send a CDP command
   */
  async send(method: string, params?: any): Promise<any> {
    if (this.closed) {
      throw new Error('CDP session is closed');
    }
    
    try {
      return await this.client.send(method as any, params);
    } catch (error) {
      const cdpError: CDPError = {
        code: -32000,
        message: error instanceof Error ? error.message : String(error)
      };
      throw cdpError;
    }
  }

  /**
   * Check if session is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get captured network requests
   */
  getNetworkRequests(): any[] {
    return Array.from(this.networkRequests.values());
  }

  /**
   * Get captured console messages
   */
  getConsoleMessages(): any[] {
    return [...this.consoleMessages];
  }

  /**
   * Get response body for a request
   */
  getResponseBody(requestId: string): string | undefined {
    return this.responseBodyCache.get(requestId);
  }

  /**
   * Evaluate JavaScript in the page context
   */
  async evaluate(expression: string): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Evaluation failed');
    }
    
    return result.result.value;
  }

  /**
   * Take a full page snapshot
   */
  async captureSnapshot(): Promise<any> {
    const snapshot = await this.send('DOMSnapshot.captureSnapshot', {
      computedStyles: ['*'],
      includePaintOrder: true,
      includeDOMRects: true
    });
    return snapshot;
  }

  /**
   * Get page metrics
   */
  async getMetrics(): Promise<any> {
    const metrics = await this.send('Performance.getMetrics');
    return metrics.metrics;
  }

  /**
   * Close the CDP session
   */
  async close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      
      try {
        // Disable domains
        for (const domain of REQUIRED_DOMAINS) {
          await this.send(`${domain}.disable`).catch(() => {});
        }
        
        // Detach the session
        await this.client.detach();
      } catch (error) {
        console.error('Error closing CDP session:', error);
      }
      
      // Clear data
      this.networkRequests.clear();
      this.consoleMessages.length = 0;
      this.responseBodyCache.clear();
      this.eventHandlers.clear();
      this.removeAllListeners();
      
      this.emit('closed');
    }
  }
}

// Export singleton instance
export const cdpManager = new CDPManager();