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
 * CDP Types - Core type definitions for Chrome DevTools Protocol
 */

export interface CDPCommand {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

export interface CDPResponse {
  id: number;
  result?: unknown;
  error?: CDPError;
}

export interface CDPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface CDPEvent {
  method: string;
  params: unknown;
  sessionId?: string;
}