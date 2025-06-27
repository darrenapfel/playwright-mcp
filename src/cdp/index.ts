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

/**
 * Chrome DevTools Protocol (CDP) Integration Module
 * 
 * This module will provide the core CDP functionality for the Playwright MCP server.
 * Phase 1 will implement:
 * - CDP session management
 * - Command sending and response handling
 * - Event subscription and notification
 * - Protocol type definitions
 */

export * from './types.js';
export * from './protocol.js';
export * from './session.js';