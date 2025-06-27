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

const cdpNetworkCapture = defineTool({
  capability: 'core',

  schema: {
    name: 'cdp_network_capture',
    title: 'Capture network traffic via CDP',
    description: 'Start or stop network traffic capture using Chrome DevTools Protocol. Captures all requests/responses including bodies.',
    inputSchema: z.object({
      action: z.enum(['start', 'stop', 'get']).describe('Action to perform: start capture, stop capture, or get current data'),
      includeResponseBodies: z.boolean().optional().default(true).describe('Whether to capture response bodies'),
      clearPrevious: z.boolean().optional().default(true).describe('Whether to clear previous captures when starting'),
    }),
    type: 'readOnly',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    
    const code = [
      `// ${params.action === 'start' ? 'Start' : params.action === 'stop' ? 'Stop' : 'Get'} network capture via CDP`,
      params.action === 'start' ? 
        `await cdpSession.send('Network.enable');` :
        params.action === 'stop' ?
        `await cdpSession.send('Network.disable');` :
        `const networkData = await cdpManager.getNetworkData(page);`
    ];

    const action = async () => {
      try {
        // Get or create CDP session for the page
        const session = await cdpManager.attachToPage(tab.page);
        
        if (params.action === 'start') {
          // Clear previous data if requested
          if (params.clearPrevious) {
            // Get fresh session to clear data
            await cdpManager.detachFromPage(tab.page);
            await cdpManager.attachToPage(tab.page);
          }
          
          return {
            content: [{
              type: 'text' as const,
              text: `Network capture started successfully.\n\nCapturing:\n- All HTTP/HTTPS requests\n- Request headers and bodies\n- Response headers${params.includeResponseBodies ? ' and bodies' : ''}\n- Timing information\n- Initiator stack traces\n\nUse action: 'get' to retrieve captured data.`
            }]
          };
        } else if (params.action === 'stop') {
          // Network capture continues in the background, just acknowledge
          return {
            content: [{
              type: 'text' as const,
              text: `Network capture stopped. Captured data is still available.\nUse action: 'get' to retrieve the data.`
            }]
          };
        } else {
          // Get captured network data
          const networkRequests = session.getNetworkRequests();
          
          // Organize data for output
          const summary = {
            totalRequests: networkRequests.length,
            requestsByType: {} as Record<string, number>,
            requestsByStatus: {} as Record<string, number>,
            requestsWithBodies: 0,
            topDomains: {} as Record<string, number>,
          };
          
          const detailedRequests = networkRequests.map(req => {
            // Count by type
            const type = req.type || 'Unknown';
            summary.requestsByType[type] = (summary.requestsByType[type] || 0) + 1;
            
            // Count by status
            if (req.response?.status) {
              const statusGroup = `${Math.floor(req.response.status / 100)}xx`;
              summary.requestsByStatus[statusGroup] = (summary.requestsByStatus[statusGroup] || 0) + 1;
            }
            
            // Count requests with bodies
            if (req.responseBody) {
              summary.requestsWithBodies++;
            }
            
            // Count by domain
            try {
              const url = new URL(req.url);
              const domain = url.hostname;
              summary.topDomains[domain] = (summary.topDomains[domain] || 0) + 1;
            } catch {}
            
            return {
              requestId: req.requestId,
              url: req.url,
              method: req.method,
              type: req.type,
              timestamp: req.timestamp,
              initiator: req.initiator?.type,
              request: {
                headers: req.headers,
              },
              response: req.response ? {
                status: req.response.status,
                statusText: req.response.statusText,
                mimeType: req.response.mimeType,
                headers: req.response.headers,
                bodySize: req.responseBody ? req.responseBody.length : 0,
                hasBody: !!req.responseBody,
                // Include first 500 chars of body if text-based
                bodySample: req.responseBody && req.response.mimeType?.includes('text') ? 
                  req.responseBody.substring(0, 500) + (req.responseBody.length > 500 ? '...' : '') : 
                  undefined
              } : null,
              timing: req.response ? {
                duration: req.response.timestamp - req.timestamp
              } : null
            };
          });
          
          // Sort domains by count
          const topDomainsList = Object.entries(summary.topDomains)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([domain, count]) => `${domain}: ${count} requests`);
          
          return {
            content: [{
              type: 'text' as const,
              text: `Network Capture Summary:
              
Total Requests: ${summary.totalRequests}
Requests with Response Bodies: ${summary.requestsWithBodies}

Requests by Type:
${Object.entries(summary.requestsByType).map(([type, count]) => `- ${type}: ${count}`).join('\n')}

Requests by Status:
${Object.entries(summary.requestsByStatus).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

Top 10 Domains:
${topDomainsList.join('\n')}

Detailed Requests (first 10):
${JSON.stringify(detailedRequests.slice(0, 10), null, 2)}

${detailedRequests.length > 10 ? `\n... and ${detailedRequests.length - 10} more requests` : ''}`
            }]
          };
        }
      } catch (error) {
        throw new Error(`CDP network capture failed: ${error instanceof Error ? error.message : String(error)}`);
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

export default [cdpNetworkCapture];