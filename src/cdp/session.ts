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

import { EventEmitter } from 'events';
import type { CDPEvent, CDPError, CDPCommand, CDPResponse } from './types.js';

/**
 * CDP Session - Core session management implementation
 */

export interface CDPConnection {
  send(method: string, params?: any): Promise<any>;
  on(event: string, handler: (params: any) => void): void;
  off(event: string, handler: (params: any) => void): void;
  close(): Promise<void>;
}

/**
 * CDP domain state tracking
 */
interface DomainState {
  enabled: boolean;
  enableTime?: number;
  disableTime?: number;
  config?: any;
}

/**
 * CDPSessionWrapper - Provides a clean interface for CDP operations
 * 
 * This wrapper adds:
 * - Domain state management
 * - Event buffering and replay
 * - Error handling and recovery
 * - Session lifecycle management
 * - Performance tracking
 */
export class CDPSessionWrapper extends EventEmitter {
  private connection: CDPConnection;
  private sessionId: string;
  private closed = false;
  private domains = new Map<string, DomainState>();
  private eventBuffer = new Map<string, any[]>();
  private eventHandlers = new Map<string, Set<Function>>();
  private commandId = 0;
  private pendingCommands = new Map<number, {
    method: string;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    timestamp: number;
  }>();

  constructor(sessionId: string, connection: CDPConnection) {
    super();
    this.sessionId = sessionId;
    this.connection = connection;
    this.setupConnectionHandlers();
  }

  /**
   * Setup connection event handlers
   */
  private setupConnectionHandlers(): void {
    // Handle CDP events
    this.connection.on('event', (event: CDPEvent) => {
      if (event.sessionId === this.sessionId) {
        this.handleEvent(event);
      }
    });

    // Handle command responses
    this.connection.on('response', (response: CDPResponse) => {
      const pending = this.pendingCommands.get(response.id);
      if (pending) {
        this.pendingCommands.delete(response.id);
        if (response.error) {
          pending.reject(response.error);
        } else {
          pending.resolve(response.result);
        }
      }
    });

    // Handle connection close
    this.connection.on('close', () => {
      this.handleConnectionClosed();
    });
  }

  /**
   * Send a CDP command
   */
  async send<T = any>(method: string, params?: any): Promise<T> {
    if (this.closed) {
      throw new Error(`CDP session ${this.sessionId} is closed`);
    }

    const id = ++this.commandId;
    
    return new Promise<T>((resolve, reject) => {
      this.pendingCommands.set(id, {
        method,
        resolve,
        reject,
        timestamp: Date.now()
      });

      const command: CDPCommand = {
        method,
        params,
        sessionId: this.sessionId
      };

      this.connection.send(method, params).catch(reject);
    });
  }

  /**
   * Enable a CDP domain
   */
  async enable(domain: string, config?: any): Promise<void> {
    if (this.domains.get(domain)?.enabled) {
      return; // Already enabled
    }

    try {
      await this.send(`${domain}.enable`, config);
      this.domains.set(domain, {
        enabled: true,
        enableTime: Date.now(),
        config
      });
    } catch (error) {
      console.error(`Failed to enable domain ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Disable a CDP domain
   */
  async disable(domain: string): Promise<void> {
    const state = this.domains.get(domain);
    if (!state?.enabled) {
      return; // Already disabled
    }

    try {
      await this.send(`${domain}.disable`);
      state.enabled = false;
      state.disableTime = Date.now();
    } catch (error) {
      console.error(`Failed to disable domain ${domain}:`, error);
      throw error;
    }
  }

  /**
   * Check if a domain is enabled
   */
  isDomainEnabled(domain: string): boolean {
    return this.domains.get(domain)?.enabled || false;
  }

  /**
   * Subscribe to CDP events
   */
  subscribe(event: string, handler: (params: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Replay buffered events if any
    const buffered = this.eventBuffer.get(event);
    if (buffered) {
      for (const params of buffered) {
        handler(params);
      }
    }

    // Also setup native event listener
    this.on(event, handler);
  }

  /**
   * Unsubscribe from CDP events
   */
  unsubscribe(event: string, handler: (params: any) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
    this.off(event, handler);
  }

  /**
   * Handle incoming CDP event
   */
  private handleEvent(event: CDPEvent): void {
    const { method, params } = event;

    // Buffer events for late subscribers
    if (!this.eventBuffer.has(method)) {
      this.eventBuffer.set(method, []);
    }
    const buffer = this.eventBuffer.get(method)!;
    buffer.push(params);
    
    // Keep only last 100 events per type
    if (buffer.length > 100) {
      buffer.shift();
    }

    // Emit to listeners
    this.emit(method, params);
  }

  /**
   * Handle connection closed
   */
  private handleConnectionClosed(): void {
    this.closed = true;
    
    // Reject all pending commands
    for (const [id, pending] of this.pendingCommands) {
      pending.reject(new Error('Connection closed'));
    }
    this.pendingCommands.clear();

    // Clear all state
    this.domains.clear();
    this.eventBuffer.clear();
    this.eventHandlers.clear();
    
    this.emit('closed');
    this.removeAllListeners();
  }

  /**
   * Get session metrics
   */
  getMetrics(): {
    sessionId: string;
    enabledDomains: string[];
    bufferedEvents: number;
    pendingCommands: number;
    uptime: number;
  } {
    const enabledDomains = Array.from(this.domains.entries())
      .filter(([_, state]) => state.enabled)
      .map(([domain]) => domain);

    const bufferedEvents = Array.from(this.eventBuffer.values())
      .reduce((sum, buffer) => sum + buffer.length, 0);

    const oldestCommand = Math.min(
      ...Array.from(this.pendingCommands.values()).map(cmd => cmd.timestamp),
      Date.now()
    );

    return {
      sessionId: this.sessionId,
      enabledDomains,
      bufferedEvents,
      pendingCommands: this.pendingCommands.size,
      uptime: Date.now() - oldestCommand
    };
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      // Disable all enabled domains
      const disablePromises = Array.from(this.domains.entries())
        .filter(([_, state]) => state.enabled)
        .map(([domain]) => this.disable(domain).catch(() => {}));
      
      await Promise.all(disablePromises);

      // Close connection
      await this.connection.close();
    } catch (error) {
      console.error('Error closing CDP session:', error);
    } finally {
      this.handleConnectionClosed();
    }
  }

  /**
   * Check if session is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

/**
 * Factory function to create CDP session wrappers
 */
export function createCDPSessionWrapper(
  sessionId: string,
  connection: CDPConnection
): CDPSessionWrapper {
  return new CDPSessionWrapper(sessionId, connection);
}