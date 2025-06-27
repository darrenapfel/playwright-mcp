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

import { z } from 'zod';
import { defineTool } from './tool.js';
import { cdpManager } from '../browser/CDPManager.js';

const cdpExecuteScript = defineTool({
  capability: 'core',

  schema: {
    name: 'cdp_execute_script',
    title: 'Execute JavaScript via CDP',
    description: 'Execute JavaScript code in the page context using Chrome DevTools Protocol. Supports async code and returns the result.',
    inputSchema: z.object({
      expression: z.string().describe('JavaScript expression to execute'),
      awaitPromise: z.boolean().optional().default(true).describe('Whether to await the result if it returns a Promise'),
      returnByValue: z.boolean().optional().default(true).describe('Whether to return the result by value (serialized)'),
      timeout: z.number().optional().default(30000).describe('Timeout in milliseconds for async operations'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    
    const code = [
      `// Execute JavaScript via CDP`,
      `const result = await cdpSession.send('Runtime.evaluate', {`,
      `  expression: ${JSON.stringify(params.expression)},`,
      `  awaitPromise: ${params.awaitPromise},`,
      `  returnByValue: ${params.returnByValue},`,
      `  timeout: ${params.timeout}`,
      `});`
    ];

    const action = async () => {
      try {
        // Get or create CDP session for the page
        const session = await cdpManager.attachToPage(tab.page);
        
        // Set up timeout for async operations
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Execution timeout')), params.timeout);
        });
        
        // Execute the script
        const resultPromise = session.send('Runtime.evaluate', {
          expression: params.expression,
          awaitPromise: params.awaitPromise,
          returnByValue: params.returnByValue,
          userGesture: true,
        });
        
        // Race between execution and timeout
        const result = await Promise.race([resultPromise, timeoutPromise]) as any;
        
        // Check for errors
        if (result.exceptionDetails) {
          const error = result.exceptionDetails;
          throw new Error(`Script execution failed: ${error.text || error.exception?.description || 'Unknown error'}\n${error.stackTrace ? 'Stack: ' + JSON.stringify(error.stackTrace) : ''}`);
        }
        
        // Return the result
        const value = result.result.value !== undefined ? result.result.value : result.result;
        
        return {
          content: [{
            type: 'text' as const,
            text: `CDP Script Execution Result:\n\nExpression:\n${params.expression}\n\nResult:\n${JSON.stringify(value, null, 2)}\n\nType: ${result.result.type}\nObject ID: ${result.result.objectId || 'N/A'}`
          }]
        };
      } catch (error) {
        throw new Error(`CDP script execution failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    return {
      code,
      action,
      captureSnapshot: false,
      waitForNetwork: false
    };
  },
});

export default [cdpExecuteScript];