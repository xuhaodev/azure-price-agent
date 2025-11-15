import OpenAI from 'openai';
import type {
    Response,
    ResponseFunctionToolCallItem,
    ResponseInput
} from 'openai/resources/responses/responses';
import { agentPrompt } from './agentPrompt';
import { azureVmSize } from './azurevmsize';
import { azureRegions } from './azure-regions';

// Responses API function tool definition (top-level name/description/parameters)
const PRICE_QUERY_TOOL = {
    type: 'function',
    name: 'odata_query',
    description: 'Retrieve data from Azure Retail Prices API based on OData query conditions, return merged JSON record list, e.g. use armRegionName and armSkuName for fuzzy queries.',
    //description: "Retrieve retail pricing information for Azure services, with filters by service name, region, currency, SKU, or price type. Useful for cost analysis and comparing Azure rates programmatically.",
  
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: "OData query conditions, best to use fuzzy queries, e.g.: armRegionName eq 'southcentralus' and contains(armSkuName, 'Redis')"
                //description: "OData-style filter string to narrow results. Example: serviceName eq 'Virtual Machines' and armRegionName eq 'eastus'"
            }
        },
        required: ['query'],
        additionalProperties: false
    },
    strict: true
} as const;

type PricingContext = {
    Items: PricingItem[];
    filter: string;
};

type PricingWorkflowHooks = {
    onPriceData?: (data: PricingContext & { totalCount: number }) => void | Promise<void>;
    onStepUpdate?: (step: string) => void | Promise<void>;
    onToolCallStart?: (toolCall: { name: string; arguments: string }) => void | Promise<void>;
    onToolCallComplete?: (toolCall: { name: string; resultCount: number }) => void | Promise<void>;
};

type PricingWorkflowResult = {
    aiResponse: string;
    pricingContext?: PricingContext;
    responseId: string; // Return response_id for maintaining session
};

let cachedClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;

    if (!endpoint?.trim() || !apiKey?.trim()) {
        throw new Error('Missing Azure OpenAI environment variables');
    }

    if (cachedClient) {
        return cachedClient;
    }

    const normalizedEndpoint = endpoint.replace(/\/+$/, '');
    const baseURL = `${normalizedEndpoint}/openai/v1/`;

    cachedClient = new OpenAI({
        apiKey,
        baseURL,
        defaultHeaders: {
            'api-key': apiKey
        }
    });

    return cachedClient;
}

function getDeploymentName() {
    return process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5-codex';
}

function buildConversation(prompt: string): ResponseInput {
    // Compress region mapping to short format
    const compactRegions = Object.entries(azureRegions)
        .map(([code, name]) => `${code}:${name}`)
        .join('|');
    
    // Compress VM types to short format
    const compactVmTypes = azureVmSize
        .map(vm => `${vm.family}[${vm.type}]:${vm.keywords}`)
        .join('|');
    
    return [
        {
            role: "system",
            content: [
                {
                    type: "input_text",
                    text: agentPrompt
                }
            ]
        },
        {
            role: "user",
            content: [
                {
                    type: "input_text",
                    text: `Region codes: ${compactRegions}\nVM families: ${compactVmTypes}`
                }
            ]
        },
        {
            role: "user",
            content: [
                {
                    type: "input_text",
                    text: prompt
                }
            ]
        }
    ] as ResponseInput;
}

function extractUnprocessedToolCalls(response: Response, processedIds: Set<string>): ResponseFunctionToolCallItem[] {
    if (!Array.isArray(response.output)) {
        return [];
    }

    return response.output
        .filter(
            (item): item is ResponseFunctionToolCallItem =>
                item?.type === 'function_call' && typeof (item as ResponseFunctionToolCallItem).call_id === 'string'
        )
        .filter((toolCall) => !processedIds.has(toolCall.call_id));
}

function parseQueryFilter(toolCall: ResponseFunctionToolCallItem): string {
    try {
        const parsedArgs = JSON.parse(toolCall.arguments ?? "{}");
        const queryFilter = parsedArgs.query;

        if (!queryFilter || typeof queryFilter !== 'string') {
            throw new Error('Invalid query filter generated');
        }

        return queryFilter;
    } catch (error) {
        console.error('Failed to parse tool arguments:', error);
        throw new Error('Invalid tool arguments received');
    }
}

function extractOutputText(response: Response): string {
    console.log('[extractOutputText] Starting extraction...');
    
    // First try: output_text field (simple string)
    if (typeof response?.output_text === 'string') {
        console.log('[extractOutputText] Found output_text:', response.output_text.length, 'chars');
        return response.output_text;
    }

    // Second try: output array
    if (!Array.isArray(response?.output)) {
        console.log('[extractOutputText] No output array found');
        return '';
    }

    console.log('[extractOutputText] Processing output array with', response.output.length, 'items');
    
    const textChunks = response.output.flatMap((item, idx) => {
        const itemType = (item as {type?: string}).type;
        console.log(`[extractOutputText] Item ${idx}: type='${itemType}'`);
        
        // Skip function calls and their outputs
        if (itemType === 'function_call' || itemType === 'function_call_output') {
            console.log(`[extractOutputText] Item ${idx}: skipping ${itemType}`);
            return [];
        }
        
        if (!('content' in item)) {
            console.log(`[extractOutputText] Item ${idx}: no content field`);
            return [];
        }

        const content = (item as { content?: Array<{ type?: string; text?: string }> }).content;

        if (!Array.isArray(content)) {
            console.log(`[extractOutputText] Item ${idx}: content is not array`);
            return [];
        }

        console.log(`[extractOutputText] Item ${idx}: content array with ${content.length} items`);
        
        // Try to extract ANY text content, being more permissive
        const texts = content
            .map((contentItem, cidx) => {
                const cType = contentItem?.type;
                const cText = contentItem?.text;
                console.log(`[extractOutputText] Item ${idx}, Content ${cidx}: type='${cType}', hasText=${!!cText}, textLength=${cText?.length || 0}`);
                
                // Accept multiple content types that contain text
                if (cType === 'output_text' || cType === 'text' || cType === 'message') {
                    return typeof cText === 'string' ? cText : '';
                }
                
                // Also try to extract text even if type is not recognized but text exists
                if (!cType && typeof cText === 'string' && cText.length > 0) {
                    console.log(`[extractOutputText] Item ${idx}, Content ${cidx}: Accepting text without type`);
                    return cText;
                }
                
                return '';
            })
            .filter(Boolean);
        
        if (texts.length > 0) {
            const totalLength = texts.join('').length;
            console.log(`[extractOutputText] Item ${idx}: extracted ${texts.length} text chunks, total length: ${totalLength}`);
        } else {
            console.log(`[extractOutputText] Item ${idx}: no text extracted`);
        }
        
        return texts;
    });

    const result = textChunks.join('');
    console.log('[extractOutputText] Final result length:', result.length);
    
    if (result.length === 0) {
        console.error('[extractOutputText] ERROR: Failed to extract any text from response');
        console.error('[extractOutputText] Response structure:', JSON.stringify({
            hasOutputText: typeof response?.output_text === 'string',
            hasOutput: Array.isArray(response?.output),
            outputLength: response?.output?.length,
            outputTypes: response?.output?.map((item: { type?: string }) => item?.type)
        }, null, 2));
    }
    
    return result;
}

function extractReasoningContent(response: Response): string {
    console.log('[extractReasoningContent] Starting extraction...');
    
    // According to OpenAI Responses API documentation:
    // - response.reasoning is just configuration (effort, summary setting)
    // - Actual reasoning content is in response.output array where type === "reasoning"
    // - Format: reasoning_item.summary[0].text
    
    const responseAny = response as unknown as { 
        reasoning?: { 
            effort?: string;
            summary?: string; // This is just config: "auto", "detailed", etc.
        };
    };
    
    console.log('[extractReasoningContent] response.reasoning (config only):', responseAny.reasoning);
    
    // Extract from output array - find item with type === "reasoning"
    // According to API: response.output[0].summary[0].text when type === "reasoning"
    if (Array.isArray(response.output) && response.output.length > 0) {
        console.log('[extractReasoningContent] Checking output array with', response.output.length, 'items');
        
        // Log all output items to understand structure
        response.output.forEach((item, idx) => {
            const typedItem = item as { type?: string; id?: string };
            console.log(`[extractReasoningContent] Output[${idx}]:`, {
                type: typedItem.type,
                id: typedItem.id?.substring(0, 30)
            });
        });
        
        // Find the first item with type === "reasoning"
        const reasoningItem = response.output.find((item) => {
            const typedItem = item as { type?: string };
            return typedItem.type === 'reasoning';
        }) as {
            type?: string;
            summary?: Array<{ text?: string; type?: string }>;
            text?: string;
            content?: Array<{ type?: string; text?: string }>;
        } | undefined;
        
        if (reasoningItem) {
            console.log('[extractReasoningContent] Found reasoning item:', {
                type: reasoningItem.type,
                hasSummary: !!reasoningItem.summary,
                summaryIsArray: Array.isArray(reasoningItem.summary),
                summaryLength: Array.isArray(reasoningItem.summary) ? reasoningItem.summary.length : 'N/A'
            });
            
            // Direct access: reasoning_item.summary[0].text
            if (Array.isArray(reasoningItem.summary) && reasoningItem.summary.length > 0) {
                const firstSummary = reasoningItem.summary[0];
                console.log('[extractReasoningContent] First summary object:', {
                    exists: !!firstSummary,
                    type: firstSummary?.type,
                    hasText: !!firstSummary?.text,
                    textType: typeof firstSummary?.text,
                    textLength: firstSummary?.text?.length || 0
                });
                
                if (firstSummary && typeof firstSummary.text === 'string' && firstSummary.text.length > 0) {
                    // Ensure we're not returning status identifiers
                    if (firstSummary.text !== 'detailed' && firstSummary.text !== 'auto') {
                        console.log('[extractReasoningContent] ✓ Successfully extracted summary[0].text:', firstSummary.text.length, 'chars');
                        console.log('[extractReasoningContent] First 500 chars:', firstSummary.text.substring(0, 500));
                        return firstSummary.text;
                    } else {
                        console.log('[extractReasoningContent] ⚠️ Skipping status identifier:', firstSummary.text);
                    }
                }
            }
        } else {
            console.log('[extractReasoningContent] ⚠️ No item with type="reasoning" found in output array');
        }
        
        // Fallback: check all output items for reasoning type
        console.log('[extractReasoningContent] Fallback: searching all output items for reasoning content');
        const reasoningItems = response.output.filter((item) => {
            const itemType = (item as { type?: string }).type;
            return itemType === 'reasoning' || itemType === 'thought';
        });
        
        console.log('[extractReasoningContent] Found', reasoningItems.length, 'reasoning-type items');
        
        if (reasoningItems.length > 0) {
            const summaryTexts = reasoningItems
                .map((item, itemIdx) => {
                    const reasoningItem = item as { 
                        type?: string;
                        summary?: Array<{ text?: string; type?: string }>;
                        text?: string;
                        content?: Array<{ type?: string; text?: string }>;
                    };
                    
                    console.log(`[extractReasoningContent] Reasoning item ${itemIdx}:`, {
                        hasSummary: !!reasoningItem.summary,
                        isArray: Array.isArray(reasoningItem.summary),
                        length: Array.isArray(reasoningItem.summary) ? reasoningItem.summary.length : 'N/A'
                    });
                    
                    // Get summary[0].text
                    if (Array.isArray(reasoningItem.summary) && reasoningItem.summary.length > 0) {
                        const firstSummary = reasoningItem.summary[0];
                        if (firstSummary && typeof firstSummary.text === 'string') {
                            console.log('[extractReasoningContent] ✓ Found text in reasoning item:', firstSummary.text.length, 'chars');
                            return firstSummary.text;
                        }
                    }
                    
                    // Try direct text property
                    if (typeof reasoningItem.text === 'string') {
                        console.log('[extractReasoningContent] Found direct text property:', reasoningItem.text.length, 'chars');
                        return reasoningItem.text;
                    }
                    
                    // Try content array
                    if (Array.isArray(reasoningItem.content)) {
                        const contentText = reasoningItem.content
                            .filter((c) => typeof c?.text === 'string')
                            .map((c) => c.text)
                            .filter(Boolean)
                            .join('');
                        if (contentText) {
                            console.log('[extractReasoningContent] Found text in content array:', contentText.length, 'chars');
                            return contentText;
                        }
                    }
                    
                    return '';
                })
                .filter(Boolean)
                .join('\n');
            
            if (summaryTexts) {
                console.log('[extractReasoningContent] Total extracted reasoning:', summaryTexts.length, 'chars');
                return summaryTexts;
            }
        }
        
        // Fallback: check all items with content arrays
        const reasoningChunks = response.output.flatMap((item) => {
            if (!('content' in item)) {
                return [];
            }

            const content = (item as { content?: Array<{ type?: string; text?: string }> }).content;

            if (!Array.isArray(content)) {
                return [];
            }

            return content
                .filter((contentItem) => contentItem?.type === 'reasoning' || contentItem?.type === 'thought')
                .map((contentItem) => (typeof contentItem?.text === 'string' ? contentItem.text : ''))
                .filter(Boolean);
        });

        if (reasoningChunks.length > 0) {
            console.log('[extractReasoningContent] Extracted from content arrays:', reasoningChunks.join('').length, 'chars');
            return reasoningChunks.join('');
        }
    }

    console.log('[extractReasoningContent] No reasoning content found');
    return '';
}

async function executePricingWorkflow(
    prompt: string, 
    previousResponseId: string | undefined,
    hooks: PricingWorkflowHooks = {}
): Promise<PricingWorkflowResult> {
    const client = getOpenAIClient();
    const model = getDeploymentName();
    const processedCalls = new Set<string>();
    let latestPricingContext: PricingContext | undefined;
    let fullResponse: Response | null = null;

    // Create streaming response with previous_response_id to continue the same conversation thread
    // The agent will decide whether to call tools based on the query

    const stream = await client.responses.create({
        model,
        input: buildConversation(prompt),
        tools: [PRICE_QUERY_TOOL],
        reasoning: { effort: "medium", summary: "auto" }, // Use medium effort to get more reasoning details
        max_output_tokens: 2000,
        stream: true, // Enable streaming
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
    });

    console.log('[DEBUG] Streaming enabled, processing events...');
    
    let reasoningExtracted = false;
    let currentResponse: Response | null = null;

    // Process streaming events
    for await (const event of stream) {
        console.log('[DEBUG] Stream event:', event.type);
        
        switch (event.type) {
            case 'response.created':
            case 'response.in_progress':
                // Response is being created/processed
                break;
                
            case 'response.output_text.delta':
                // Streaming text delta - could be used for real-time display
                if ('delta' in event && event.delta) {
                    // Text delta available for streaming (future enhancement)
                }
                break;
                
            case 'response.output_item.done':
                // An output item is complete (could be reasoning, message, or function call)
                if (!reasoningExtracted && currentResponse && hooks.onStepUpdate) {
                    const reasoning = extractReasoningContent(currentResponse);
                    if (reasoning) {
                        const cleanReasoning = reasoning
                            .replace(/\*\*/g, '')
                            .replace(/\n+/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        
                        const words = cleanReasoning.split(/\s+/);
                        const first15Words = words.slice(0, 15).join(' ');
                        const displayReasoning = words.length > 15 
                            ? `${first15Words}...` 
                            : first15Words;
                        
                        await hooks.onStepUpdate(`💭 ${displayReasoning}`);
                        reasoningExtracted = true;
                    }
                }
                break;
                
            case 'response.completed':
                // Response is fully complete
                if ('response' in event && event.response) {
                    fullResponse = event.response as Response;
                    currentResponse = fullResponse;
                }
                console.log('[DEBUG] Response completed');
                break;
                
            case 'error':
                console.error('[DEBUG] Stream error:', event);
                const errorMsg = 'error' in event && event.error ? 
                    (typeof event.error === 'string' ? event.error : JSON.stringify(event.error)) : 
                    'Stream error occurred';
                throw new Error(errorMsg);
                
            default:
                // Store response updates during streaming
                if ('response' in event && event.response) {
                    currentResponse = event.response as Response;
                }
                break;
        }
    }

    if (!fullResponse) {
        throw new Error('Stream completed without final response');
    }

    let response = fullResponse;

    // Log response structure for debugging
    console.log('[DEBUG] Response object keys:', Object.keys(response));
    console.log('[DEBUG] Response.reasoning:', JSON.stringify(response.reasoning, null, 2));
    
    // Extract reasoning if not already done during streaming
    if (!reasoningExtracted) {
        const reasoning = extractReasoningContent(response);
        console.log('[DEBUG] Extracted reasoning length:', reasoning.length);
        
        if (reasoning && hooks.onStepUpdate) {
            const cleanReasoning = reasoning
                .replace(/\*\*/g, '')
                .replace(/\n+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            
            const words = cleanReasoning.split(/\s+/);
            const first10Words = words.slice(0, 10).join(' ');
            const displayReasoning = words.length > 10 
                ? `${first10Words}...` 
                : first10Words;
            
            await hooks.onStepUpdate(`💭 ${displayReasoning}`);
        } else if (hooks.onStepUpdate) {
            await hooks.onStepUpdate('🧠 Agent is working...');
        }
    }

    while (true) {
        const toolCalls = extractUnprocessedToolCalls(response, processedCalls);

        if (toolCalls.length === 0) {
            break;
        }

        // Notify: Found tool calls
        if (hooks.onStepUpdate && toolCalls.length > 0) {
            await hooks.onStepUpdate(`✅ Decision: Execute ${toolCalls.length} pricing ${toolCalls.length > 1 ? 'queries' : 'query'}`);
        }

        const toolOutputs: ResponseInput = [];

        for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            let queryFilter = parseQueryFilter(toolCall);
            
            // Fix OData filter case sensitivity issues
            queryFilter = queryFilter
                .replace(/armregionname/gi, 'armRegionName')
                .replace(/armskuname/gi, 'armSkuName')
                .replace(/metername/gi, 'meterName')
                .replace(/productname/gi, 'productName')
                .replace(/servicename/gi, 'serviceName');
            
            // Log OData query to server terminal for diagnostics
            console.log('\n' + '='.repeat(80));
            console.log(`[Agent OData Query ${i + 1}/${toolCalls.length}]`);
            console.log('Filter:', queryFilter);
            console.log('='.repeat(80) + '\n');
            
            // Show the actual query being executed
            if (hooks.onStepUpdate) {
                // Extract key parts from the query for display
                const regionMatch = queryFilter.match(/armRegionName eq '([^']+)'/);
                const skuMatch = queryFilter.match(/contains\(armSkuName, '([^']+)'\)/);
                const serviceMatch = queryFilter.match(/contains\(serviceName, '([^']+)'\)/);
                
                let queryDesc = `Query ${i + 1}/${toolCalls.length}`;
                if (serviceMatch) queryDesc += ` - ${serviceMatch[1]}`;
                if (skuMatch) queryDesc += ` ${skuMatch[1]}`;
                if (regionMatch) queryDesc += ` in ${regionMatch[1]}`;
                
                await hooks.onStepUpdate(`🔎 ${queryDesc}`);
            }

            // Use retry mechanism with query broadening
            let priceResult;
            try {
                priceResult = await fetchPricesWithRetry(queryFilter, {
                    onStepUpdate: hooks.onStepUpdate
                });
            } catch (error) {
                console.error(`[Query ${i + 1}/${toolCalls.length}] Execution failed:`, error);
                
                // Send error feedback to user
                if (hooks.onStepUpdate) {
                    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                    await hooks.onStepUpdate(`❌ Query ${i + 1}/${toolCalls.length} failed: ${errorMsg}`);
                }
                
                // Return error information to agent so it can adjust
                toolOutputs.push({
                    type: 'function_call_output',
                    call_id: toolCall.call_id,
                    output: JSON.stringify({
                        error: true,
                        message: error instanceof Error ? error.message : 'Query execution failed',
                        originalFilter: queryFilter,
                        suggestion: 'The OData query syntax is invalid. Please check: 1) All quotes are properly closed, 2) Parentheses are balanced, 3) Field names are correct (armRegionName, armSkuName, etc), 4) Use tolower() for case-insensitive matching'
                    })
                });
                
                processedCalls.add(toolCall.call_id);
                continue; // Skip to next query instead of failing entire workflow
            }

            // Log query result to terminal
            console.log(`[Query Result] Found ${priceResult.Items.length} items`);
            if (priceResult.attemptCount > 1) {
                console.log(`[Query Broadening] Required ${priceResult.attemptCount} attempts`);
                console.log(`[Final Filter] ${priceResult.finalFilter}`);
            }

            latestPricingContext = {
                Items: priceResult.Items,
                filter: priceResult.finalFilter // Use the final filter that actually returned results
            };

            // Notify progress with more details
            if (hooks.onStepUpdate) {
                if (priceResult.Items.length > 0) {
                    // Show price range if available
                    const prices = priceResult.Items.map(item => item.retailPrice).filter(p => typeof p === 'number');
                    if (prices.length > 0) {
                        const minPrice = Math.min(...prices);
                        const maxPrice = Math.max(...prices);
                        const retryInfo = priceResult.attemptCount > 1 ? ` (after ${priceResult.attemptCount} attempts)` : '';
                        await hooks.onStepUpdate(`✅ Query ${i + 1}/${toolCalls.length}: Found ${priceResult.Items.length} results${retryInfo} (${minPrice === maxPrice ? `$${minPrice.toFixed(4)}` : `$${minPrice.toFixed(4)} - $${maxPrice.toFixed(4)}`})`);
                    } else {
                        const retryInfo = priceResult.attemptCount > 1 ? ` (after ${priceResult.attemptCount} attempts)` : '';
                        await hooks.onStepUpdate(`✅ Query ${i + 1}/${toolCalls.length}: Found ${priceResult.Items.length} results${retryInfo}`);
                    }
                } else {
                    await hooks.onStepUpdate(`⚠️ Query ${i + 1}/${toolCalls.length}: No results found after ${priceResult.attemptCount} attempts`);
                }
            }

            // Send price data via SSE - even if empty (for consistency)
            if (hooks.onPriceData) {
                const priceDataToSend = {
                    ...latestPricingContext,
                    totalCount: priceResult.Items.length
                };
                console.log(`[onPriceData] Calling hook with ${priceDataToSend.Items.length} items`);
                console.log(`[onPriceData] Filter: ${priceDataToSend.filter}`);
                console.log(`[onPriceData] First item:`, priceDataToSend.Items[0] || 'N/A');
                
                await hooks.onPriceData(priceDataToSend);
                console.log(`[onPriceData] Hook completed successfully`);
            } else {
                console.warn('[onPriceData] Hook not available!');
            }

            toolOutputs.push({
                type: 'function_call_output',
                call_id: toolCall.call_id,
                output: JSON.stringify({
                    Items: priceResult.Items,
                    filter: priceResult.finalFilter,
                    attemptCount: priceResult.attemptCount,
                    originalFilter: queryFilter,
                    // Add helpful context when no results found
                    ...(priceResult.Items.length === 0 ? {
                        suggestion: 'No results found. Consider: 1) Check region name spelling, 2) Try broader SKU/service name keywords, 3) Verify the service exists in this region, 4) Use contains() instead of exact match'
                    } : {})
                })
            });

            processedCalls.add(toolCall.call_id);
        }

        // Notify: Processing results
        if (hooks.onStepUpdate) {
            await hooks.onStepUpdate('🧠 Analyzing collected data...');
        }

        const analysisResponse = await client.responses.create({
            model,
            previous_response_id: response.id,
            input: toolOutputs,
            reasoning: { effort: "medium", "summary": "auto" },
            max_output_tokens: 2000
        });

        console.log('[DEBUG] Analysis response keys:', Object.keys(analysisResponse));
        if (process.env.NODE_ENV === 'development') {
            console.log('[DEBUG] Analysis output summary:', analysisResponse.output?.map(item => ({ 
                type: (item as {type?: string}).type,
                id: (item as {id?: string}).id?.substring(0, 20)
            })));
        }
        
        // Check if agent wants to retry with new queries when results are empty
        const hasNewToolCalls = extractUnprocessedToolCalls(analysisResponse, processedCalls).length > 0;
        const hasEmptyResults = !latestPricingContext || latestPricingContext.Items.length === 0;
        
        if (hasNewToolCalls && hasEmptyResults) {
            console.log('[Agent Retry] Agent is attempting new queries after empty results');
            if (hooks.onStepUpdate) {
                await hooks.onStepUpdate('🔄 Adjusting search strategy based on results...');
            }
            // Continue the loop to process new tool calls
            continue;
        }

        // Extract and notify reasoning after data analysis
        const analysisReasoning = extractReasoningContent(analysisResponse);
        console.log('[DEBUG] Analysis reasoning length:', analysisReasoning.length);
        
        if (analysisReasoning && hooks.onStepUpdate) {
            // Show only ONE thought with first 10 words for elegant display
            const cleanAnalysis = analysisReasoning
                .replace(/\*\*/g, '')      // Remove markdown bold
                .replace(/\n+/g, ' ')      // Remove newlines
                .replace(/\s+/g, ' ')      // Collapse spaces
                .trim();
            
            const words = cleanAnalysis.split(/\s+/);
            const first10Words = words.slice(0, 10).join(' ');
            const displayAnalysis = words.length > 10
                ? `${first10Words}...`
                : first10Words;
            
            if (displayAnalysis) {
                await hooks.onStepUpdate(`💡 ${displayAnalysis}`);
            }
        } else if (hooks.onStepUpdate) {
            // Show generic analysis steps if no reasoning extracted
            if (latestPricingContext && latestPricingContext.Items.length > 0) {
                await hooks.onStepUpdate(`💡 Comparing ${latestPricingContext.Items.length} pricing options...`);
                await hooks.onStepUpdate('💡 Identifying optimal choices and trade-offs...');
            }
        }
        
        // Update response for next iteration
        response = analysisResponse;
    }

    // Notify: Finalizing
    if (hooks.onStepUpdate) {
        await hooks.onStepUpdate('📝 Preparing recommendations...');
    }

    const aiResponse = extractOutputText(response).trim();
    
    // Diagnostic logging for final response
    console.log('\n' + '='.repeat(80));
    console.log('[Final AI Response Diagnostics]');
    console.log('Response ID:', response.id);
    console.log('Has output_text:', typeof response.output_text === 'string');
    if (typeof response.output_text === 'string') {
        console.log('output_text length:', response.output_text.length);
        console.log('output_text preview:', response.output_text.substring(0, 200));
    }
    console.log('Has output array:', Array.isArray(response.output));
    if (Array.isArray(response.output)) {
        console.log('Output array length:', response.output.length);
        console.log('Output item types:', response.output.map(item => (item as {type?: string}).type));
        
        // Log detailed structure for debugging
        response.output.forEach((item, idx) => {
            const itemWithContent = item as { 
                type?: string; 
                text?: string;
                content?: Array<{ type?: string; text?: string }> 
            };
            console.log(`\n--- Output Item ${idx} ---`);
            console.log('  Type:', itemWithContent.type);
            console.log('  Has text (direct):', 'text' in itemWithContent);
            console.log('  Has content:', 'content' in itemWithContent);
            
            // For reasoning items, check if they have direct text
            if (itemWithContent.type === 'reasoning' && 'text' in itemWithContent) {
                console.log('  Direct text length:', typeof itemWithContent.text === 'string' ? itemWithContent.text.length : 'N/A');
                if (typeof itemWithContent.text === 'string' && itemWithContent.text.length > 0) {
                    console.log('  Direct text preview:', itemWithContent.text.substring(0, 150), '...');
                }
            }
            
            if ('content' in itemWithContent && Array.isArray(itemWithContent.content)) {
                console.log(`  Content array length: ${itemWithContent.content.length}`);
                itemWithContent.content.forEach((c, cidx) => {
                    console.log(`    Content ${cidx}:`);
                    console.log(`      type: ${c?.type}`);
                    console.log(`      hasText: ${!!c?.text}`);
                    if (c?.text) {
                        console.log(`      text length: ${c.text.length}`);
                        console.log(`      text preview: ${c.text.substring(0, 150)}...`);
                    }
                });
            }
        });
    }
    console.log('\nExtracted aiResponse length:', aiResponse.length);
    if (aiResponse.length > 0) {
        console.log('Extracted aiResponse preview:', aiResponse.substring(0, 300));
    } else {
        console.error('ERROR: aiResponse is EMPTY - no text was extracted!');
    }
    console.log('='.repeat(80) + '\n');
    
    if (hooks.onStepUpdate) {
        await hooks.onStepUpdate('✨ Response ready');
    }

    return {
        aiResponse,
        pricingContext: latestPricingContext,
        responseId: response.id // Return response_id
    };
}

export async function queryPricing(
    prompt: string, 
    previousResponseId?: string
): Promise<{ filter?: string, items?: PricingItem[], aiResponse: string, responseId: string }> {
    const { aiResponse, pricingContext, responseId } = await executePricingWorkflow(prompt, previousResponseId);

    if (!pricingContext) {
        return {
            aiResponse: aiResponse || 'No response generated',
            responseId
        };
    }

    return {
        filter: pricingContext.filter,
        items: pricingContext.Items,
        aiResponse: aiResponse || 'No response generated',
        responseId
    };
}

export async function queryPricingWithStreamingResponse(
    prompt: string,
    previousResponseId?: string
): Promise<ReadableStream> {
    const encoder = new TextEncoder();

    return new ReadableStream({
        async start(controller) {
            try {
                // Send initial heartbeat to establish connection
                controller.enqueue(encoder.encode(': heartbeat\n\n'));
                
                const { aiResponse, pricingContext, responseId } = await executePricingWorkflow(prompt, previousResponseId, {
                    onStepUpdate: async (step) => {
                        // Send step update to client directly
                        const stepPayload = {
                            type: 'step_update',
                            data: { message: step }
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(stepPayload)}\n\n`));
                        // Flush immediately for Azure Web App
                        await new Promise(resolve => setTimeout(resolve, 0));
                    },
                    onPriceData: async (data) => {
                        // Validate data structure
                        if (!data || !Array.isArray(data.Items)) {
                            console.error('[Streaming] Invalid data structure received in onPriceData:', data);
                            return;
                        }
                        
                        const itemsCount = data.Items.length;
                        console.log(`[Streaming] ========== SENDING PRICE DATA ==========`);
                        console.log(`[Streaming] Items count: ${itemsCount}`);
                        console.log(`[Streaming] Filter: ${data.filter}`);
                        console.log(`[Streaming] Total count: ${data.totalCount}`);
                        
                        const payload = {
                            type: 'price_data',
                            data: {
                                Items: data.Items,
                                totalCount: data.totalCount,
                                filter: data.filter
                            }
                        };
                        
                        const payloadStr = JSON.stringify(payload);
                        console.log(`[Streaming] Payload size: ${payloadStr.length} bytes`);
                        console.log(`[Streaming] First item:`, data.Items[0] || 'N/A');
                        
                        controller.enqueue(encoder.encode(`data: ${payloadStr}\n\n`));
                        console.log(`[Streaming] price_data SSE message sent successfully`);
                        console.log(`[Streaming] ==========================================`);
                        
                        // Flush immediately
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }
                });

                // Send response_id to client to establish/maintain session context
                // All interactions in the same session will use the same response_id
                const responseIdPayload = {
                    type: 'response_id',
                    data: { response_id: responseId }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(responseIdPayload)}\n\n`));

                // Log streaming response handling
                console.log('[Streaming] aiResponse length:', aiResponse?.length || 0);
                console.log('[Streaming] has pricingContext:', !!pricingContext);

                if (!pricingContext) {
                    console.log('[Streaming] No pricing context - streaming direct_response');
                    
                    const responseText = aiResponse || 'No response generated';
                    const words = responseText.split(/(\s+)/);
                    
                    for (const word of words) {
                        if (word) {
                            const chunkPayload = {
                                type: 'ai_response_chunk',
                                data: { content: word }
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`));
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                    }
                    
                    // Send completion
                    const completionPayload = {
                        type: 'ai_response_complete',
                        data: { content: responseText }
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionPayload)}\n\n`));
                    controller.close();
                    return;
                }

                if (aiResponse) {
                    console.log('[Streaming] Streaming ai_response with', aiResponse.length, 'chars');
                    
                    // Stream response character by character for typing effect
                    const words = aiResponse.split(/(\s+)/); // Split by whitespace but keep the separators
                    
                    for (const word of words) {
                        if (word) {
                            const chunkPayload = {
                                type: 'ai_response_chunk',
                                data: { content: word }
                            };
                            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`));
                            
                            // Small delay for smooth typing effect (adjust as needed)
                            await new Promise(resolve => setTimeout(resolve, 20));
                        }
                    }
                    
                    console.log('[Streaming] Finished streaming response');
                } else {
                    console.warn('[Streaming] WARNING: aiResponse is empty but pricingContext exists!');
                }

                console.log('[Streaming] Sending ai_response_complete');
                // Don't send Items again - they were already sent in price_data event
                // This prevents huge SSE messages that can cause issues in Azure Web App
                const completionPayload = {
                    type: 'ai_response_complete',
                    data: {
                        content: aiResponse || 'No response generated'
                        // Removed Items and filter - already sent via price_data
                    }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionPayload)}\n\n`));
                console.log('[Streaming] Stream completed successfully');
                controller.close();

            } catch (error) {
                console.error('Stream error:', error);
                const errorData = {
                    type: 'error',
                    data: { message: error instanceof Error ? error.message : 'Unknown error' }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorData)}\n\n`));
                controller.close();
            }
        }
    });
}

/**
 * Broaden a query by removing the last keyword from productName or meterName contains clauses
 * Returns null if the query cannot be broadened further
 */
function broadenQuery(filter: string): string | null {
    // Extract region part (keep it unchanged)
    const regionMatch = filter.match(/armRegionName eq '[^']+'/);
    const regionPart = regionMatch ? regionMatch[0] : '';
    
    // Extract all contains clauses
    const containsPattern = /contains\(tolower\((productName|meterName)\),\s*'([^']+)'\)/gi;
    const matches = Array.from(filter.matchAll(containsPattern));
    
    if (matches.length === 0) {
        return null; // Cannot broaden further
    }
    
    // Group by field name (productName vs meterName)
    const productNameClauses: string[] = [];
    const meterNameClauses: string[] = [];
    
    for (const match of matches) {
        const fieldName = match[1].toLowerCase();
        const keyword = match[2];
        if (fieldName === 'productname') {
            productNameClauses.push(keyword);
        } else if (fieldName === 'metername') {
            meterNameClauses.push(keyword);
        }
    }
    
    // Try to remove last meterName keyword first, then productName
    let newClauses: string[] = [];
    
    if (meterNameClauses.length > 1) {
        // Remove last meterName keyword, keep productName
        const shortenedMeterName = meterNameClauses.slice(0, -1);
        newClauses = [
            ...productNameClauses.map(k => `contains(tolower(productName), '${k}')`),
            ...shortenedMeterName.map(k => `contains(tolower(meterName), '${k}')`)
        ];
    } else if (meterNameClauses.length === 1) {
        if (productNameClauses.length > 0) {
            // Remove productName, keep the single meterName keyword
            newClauses = meterNameClauses.map(k => `contains(tolower(meterName), '${k}')`);
        } else {
            // Only one meterName keyword and no productName, cannot broaden further
            return null;
        }
    } else if (productNameClauses.length > 1) {
        // Only productName clauses exist (no meterName), remove last one
        const shortenedProductName = productNameClauses.slice(0, -1);
        newClauses = shortenedProductName.map(k => `contains(tolower(productName), '${k}')`);
    } else {
        // Only one clause remaining (single productName or no clauses), cannot broaden
        return null;
    }
    
    // Reconstruct query
    const parts = [];
    if (regionPart) {
        parts.push(regionPart);
    }
    parts.push(...newClauses);
    
    return parts.join(' and ');
}

export async function fetchPrices(filter: string) {
    // Validate filter before making request
    if (!filter || typeof filter !== 'string' || filter.trim().length === 0) {
        throw new Error('Invalid filter: filter cannot be empty');
    }
    
    // Check for common OData syntax issues
    const hasUnmatchedQuotes = (filter.match(/'/g) || []).length % 2 !== 0;
    const hasUnmatchedParens = (filter.match(/\(/g) || []).length !== (filter.match(/\)/g) || []).length;
    
    if (hasUnmatchedQuotes) {
        console.error('[fetchPrices] Validation Error: Unmatched quotes in filter:', filter);
        throw new Error('Invalid OData query: unmatched quotes');
    }
    
    if (hasUnmatchedParens) {
        console.error('[fetchPrices] Validation Error: Unmatched parentheses in filter:', filter);
        throw new Error('Invalid OData query: unmatched parentheses');
    }
    
    // Check for common typos in function names
    const invalidFunctions = filter.match(/\b(tollower|toupper|tolwer|tolowr)\(/gi);
    if (invalidFunctions) {
        console.error('[fetchPrices] Validation Error: Invalid function name found:', invalidFunctions[0]);
        console.error('[fetchPrices] Did you mean: tolower() or toupper()?');
        throw new Error(`Invalid OData query: '${invalidFunctions[0]}' is not a valid function. Did you mean 'tolower(' or 'toupper('?`);
    }
    
    const api_url = "https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview";
    let allItems: PricingItem[] = [];
    let nextPageUrl = `${api_url}&$filter=${encodeURIComponent(filter)}`;
    
    console.log('[fetchPrices] Original filter:', filter);
    console.log('[fetchPrices] Encoded URL length:', nextPageUrl.length, 'chars');
    console.log('[fetchPrices] Full URL:', nextPageUrl);
    
    // Check URL length (Azure API has limits)
    if (nextPageUrl.length > 4000) {
        console.warn('[fetchPrices] Warning: URL is very long (', nextPageUrl.length, 'chars), may cause issues');
    }

    while (nextPageUrl) {
        try {
            // Add timeout using AbortController
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
            
            const response = await fetch(nextPageUrl, {
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                let errorDetails = `Status: ${response.status} ${response.statusText}`;
                try {
                    const errorBody = await response.text();
                    console.error('[fetchPrices] Error response body:', errorBody);
                    errorDetails += ` - ${errorBody.substring(0, 500)}`;
                } catch (e) {
                    console.error('[fetchPrices] Could not read error body:', e);
                }
                
                // For 400 errors, include the filter that caused the issue
                if (response.status === 400) {
                    console.error('[fetchPrices] Bad Request - Filter:', filter);
                    console.error('[fetchPrices] Full URL:', nextPageUrl);
                    throw new Error(`Bad Request (400): The OData query is invalid. ${errorDetails}`);
                }
                
                throw new Error(`Failed to fetch prices: ${errorDetails}`);
            }
            const data = await response.json();
            if (data.Items && Array.isArray(data.Items)) {
                const processedItems = data.Items.map((item: Record<string, unknown>) => ({
                    armSkuName: item.armSkuName,
                    retailPrice: item.retailPrice,
                    unitOfMeasure: item.unitOfMeasure,
                    armRegionName: item.armRegionName,
                    meterId: item.meterId,
                    meterName: item.meterName,
                    productName: item.productName,
                    type: item.type,
                    location: item.location,
                    reservationTerm: item.reservationTerm,
                    savingsPlan: item.savingsPlan
                }));
                allItems = [...allItems, ...processedItems];
                console.log(`[fetchPrices] Fetched ${processedItems.length} items, total: ${allItems.length}`);
            }
            nextPageUrl = data.NextPageLink || '';
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                console.error('[fetchPrices] Request timeout');
                throw new Error('Request timeout - Azure Prices API did not respond in time');
            }
            throw error;
        }
    }

    return { Items: allItems };
}

/**
 * Fetch prices with automatic retry and query broadening
 * If initial query returns 0 results, will retry up to 3 times with progressively broader queries
 */
async function fetchPricesWithRetry(
    initialFilter: string,
    hooks?: { onStepUpdate?: (step: string) => void | Promise<void> }
): Promise<{ Items: PricingItem[], finalFilter: string, attemptCount: number }> {
    const MAX_ATTEMPTS = 3;
    let currentFilter = initialFilter;
    let attemptCount = 0;
    
    while (attemptCount < MAX_ATTEMPTS) {
        attemptCount++;
        
        if (attemptCount > 1) {
            console.log(`[Query Retry ${attemptCount}/${MAX_ATTEMPTS}] Broadening query...`);
            console.log('[Broadened Filter]', currentFilter);
            
            if (hooks?.onStepUpdate) {
                await hooks.onStepUpdate(`🔄 Retry attempt ${attemptCount}/${MAX_ATTEMPTS}: Broadening query scope...`);
            }
        }
        
        const result = await fetchPrices(currentFilter);
        
        if (result.Items.length > 0) {
            // Success - found results
            if (attemptCount > 1 && hooks?.onStepUpdate) {
                await hooks.onStepUpdate(`✅ Found ${result.Items.length} results with broader query`);
            }
            return {
                Items: result.Items,
                finalFilter: currentFilter,
                attemptCount
            };
        }
        
        // No results - try to broaden the query
        if (attemptCount < MAX_ATTEMPTS) {
            const broadenedFilter = broadenQuery(currentFilter);
            if (!broadenedFilter) {
                // Cannot broaden further
                if (hooks?.onStepUpdate) {
                    await hooks.onStepUpdate(`⚠️ Cannot broaden query further - no results found`);
                }
                break;
            }
            currentFilter = broadenedFilter;
        }
    }
    
    // All attempts exhausted or cannot broaden further
    return {
        Items: [],
        finalFilter: currentFilter,
        attemptCount
    };
}

// The old convertJsonToFilter function is no longer needed, use OData queries generated by LLM directly

export interface PricingItem {
    armSkuName: string;
    retailPrice: number;
    unitOfMeasure: string;
    armRegionName: string;
    meterId: string;
    meterName: string;
    productName: string;
    type: string;
    location?: string;
    reservationTerm?: string;
    savingsPlan?: Array<{ term: string, retailPrice: string }>;
}
