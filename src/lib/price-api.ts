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
    // description: 'Retrieve data from Azure Retail Prices API based on OData query conditions, return merged JSON record list, only use armRegionName and armSkuName for fuzzy queries.',
    description: "Retrieve retail pricing information for Azure services, with filters by service name, region, currency, SKU, or price type. Useful for cost analysis and comparing Azure rates programmatically.",
  
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                //description: "OData query conditions, e.g.: armRegionName eq 'southcentralus' and contains(armSkuName, 'Redis')"
                description: "OData-style filter string to narrow results. Example: serviceName eq 'Virtual Machines' and armRegionName eq 'eastus'"
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
    if (typeof response?.output_text === 'string') {
        return response.output_text;
    }

    if (!Array.isArray(response?.output)) {
        return '';
    }

    const textChunks = response.output.flatMap((item) => {
        if (!('content' in item)) {
            return [];
        }

        const content = (item as { content?: Array<{ type?: string; text?: string }> }).content;

        if (!Array.isArray(content)) {
            return [];
        }

        return content
            .filter((contentItem) => contentItem?.type === 'output_text' || contentItem?.type === 'text')
            .map((contentItem) => (typeof contentItem?.text === 'string' ? contentItem.text : ''))
            .filter(Boolean);
    });

    return textChunks.join('');
}

function extractReasoningContent(response: Response): string {
    // Try to extract reasoning content from response
    // The Response object may contain reasoning_content field
    const responseAny = response as unknown as { 
        reasoning_content?: string | Array<{ type?: string; text?: string }>;
        reasoning?: { summary?: string[] };
    };
    
    if (typeof responseAny.reasoning_content === 'string') {
        return responseAny.reasoning_content;
    }
    
    if (Array.isArray(responseAny.reasoning_content)) {
        return responseAny.reasoning_content
            .filter(item => item?.type === 'text' && typeof item?.text === 'string')
            .map(item => item.text)
            .filter(Boolean)
            .join('');
    }

    // Try to extract from reasoning.summary field
    if (responseAny.reasoning?.summary && Array.isArray(responseAny.reasoning.summary)) {
        const summaryText = responseAny.reasoning.summary
            .filter(item => typeof item === 'string' && item.trim().length > 0)
            .join('. ');
        if (summaryText) return summaryText;
    }

    // Try to extract from output array if reasoning is embedded
    if (Array.isArray(response.output)) {
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
            return reasoningChunks.join('');
        }
    }

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

    // Create response with previous_response_id to continue the same conversation thread
    // The agent will decide whether to call tools based on the query
    if (hooks.onStepUpdate) {
        await hooks.onStepUpdate('🧠 Agent is thinking...');
    }

    let response: Response = await client.responses.create({
        model,
        input: buildConversation(prompt),
        tools: [PRICE_QUERY_TOOL],
        reasoning: { effort: "medium",
            "summary": "auto"
         }, // Use medium effort to get more reasoning details
        max_output_tokens: 4000, // Allow up to 4000 tokens for detailed analysis and recommendations
        ...(previousResponseId ? { previous_response_id: previousResponseId } : {})
    });

    // Log response structure for debugging
    console.log('[DEBUG] Response object keys:', Object.keys(response));
    if (process.env.NODE_ENV === 'development') {
        console.log('[DEBUG] Response output summary:', response.output?.map(item => ({ 
            type: (item as {type?: string}).type, 
            id: (item as {id?: string}).id?.substring(0, 20) 
        })));
    }
    
    // Extract and notify reasoning/thinking process
    const reasoning = extractReasoningContent(response);
    console.log('[DEBUG] Extracted reasoning length:', reasoning.length);
    
    if (reasoning && hooks.onStepUpdate) {
        // Split reasoning into sentences or key points for better display
        const reasoningLines = reasoning
            .split(/[.!?]\s+/)
            .filter(line => line.trim().length > 10)
            .slice(0, 3); // Show first 3 key thoughts
        
        for (const thought of reasoningLines) {
            if (thought.trim()) {
                await hooks.onStepUpdate(`💭 Thinking: ${thought.trim()}`);
            }
        }
    } else if (hooks.onStepUpdate) {
        // Always show something even if no reasoning extracted - analyze the query
        await hooks.onStepUpdate('💭 Parsing query requirements...');
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
            const queryFilter = parseQueryFilter(toolCall);
            
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

            const priceData = await fetchPrices(queryFilter);

            latestPricingContext = {
                Items: priceData.Items,
                filter: queryFilter
            };

            // Notify progress with more details
            if (hooks.onStepUpdate) {
                if (priceData.Items.length > 0) {
                    // Show price range if available
                    const prices = priceData.Items.map(item => item.retailPrice).filter(p => typeof p === 'number');
                    if (prices.length > 0) {
                        const minPrice = Math.min(...prices);
                        const maxPrice = Math.max(...prices);
                        await hooks.onStepUpdate(`✅ Query ${i + 1}/${toolCalls.length}: Found ${priceData.Items.length} results (${minPrice === maxPrice ? `$${minPrice.toFixed(4)}` : `$${minPrice.toFixed(4)} - $${maxPrice.toFixed(4)}`})`);
                    } else {
                        await hooks.onStepUpdate(`✅ Query ${i + 1}/${toolCalls.length}: Found ${priceData.Items.length} results`);
                    }
                } else {
                    await hooks.onStepUpdate(`⚠️ Query ${i + 1}/${toolCalls.length}: No results found`);
                }
            }

            if (hooks.onPriceData) {
                await hooks.onPriceData({
                    ...latestPricingContext,
                    totalCount: priceData.Items.length
                });
            }

            toolOutputs.push({
                type: 'function_call_output',
                call_id: toolCall.call_id,
                output: JSON.stringify({
                    Items: priceData.Items,
                    filter: queryFilter
                })
            });

            processedCalls.add(toolCall.call_id);
        }

        // Notify: Processing results
        if (hooks.onStepUpdate) {
            await hooks.onStepUpdate('🧠 Analyzing collected data...');
        }

        response = await client.responses.create({
            model,
            previous_response_id: response.id,
            input: toolOutputs,
            reasoning: { effort: "medium",
                "summary": "auto"
             }, // Use medium effort to get reasoning details
            max_output_tokens: 4000 // Allow sufficient tokens for comprehensive analysis
        });

        console.log('[DEBUG] Analysis response keys:', Object.keys(response));
        if (process.env.NODE_ENV === 'development') {
            console.log('[DEBUG] Analysis output summary:', response.output?.map(item => ({ 
                type: (item as {type?: string}).type,
                id: (item as {id?: string}).id?.substring(0, 20)
            })));
        }

        // Extract and notify reasoning after data analysis
        const analysisReasoning = extractReasoningContent(response);
        console.log('[DEBUG] Analysis reasoning length:', analysisReasoning.length);
        
        if (analysisReasoning && hooks.onStepUpdate) {
            const reasoningLines = analysisReasoning
                .split(/[.!?]\s+/)
                .filter(line => line.trim().length > 10)
                .slice(0, 3); // Show first 3 analysis thoughts
            
            for (const thought of reasoningLines) {
                if (thought.trim()) {
                    await hooks.onStepUpdate(`💡 Analysis: ${thought.trim()}`);
                }
            }
        } else if (hooks.onStepUpdate) {
            // Show generic analysis steps if no reasoning extracted
            if (latestPricingContext && latestPricingContext.Items.length > 0) {
                await hooks.onStepUpdate(`💡 Comparing ${latestPricingContext.Items.length} pricing options...`);
                await hooks.onStepUpdate('💡 Identifying optimal choices and trade-offs...');
            }
        }
    }

    // Notify: Finalizing
    if (hooks.onStepUpdate) {
        await hooks.onStepUpdate('📝 Preparing recommendations...');
    }

    const aiResponse = extractOutputText(response).trim();
    
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
                const { aiResponse, pricingContext, responseId } = await executePricingWorkflow(prompt, previousResponseId, {
                    onStepUpdate: async (step) => {
                        // Send step update to client
                        const stepPayload = {
                            type: 'step_update',
                            data: { message: step }
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(stepPayload)}\n\n`));
                    },
                    onPriceData: async (data) => {
                        const payload = {
                            type: 'price_data',
                            data: {
                                Items: data.Items,
                                totalCount: data.totalCount,
                                filter: data.filter
                            }
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
                    }
                });

                // Send response_id to client to establish/maintain session context
                // All interactions in the same session will use the same response_id
                const responseIdPayload = {
                    type: 'response_id',
                    data: { response_id: responseId }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(responseIdPayload)}\n\n`));

                if (!pricingContext) {
                    const directPayload = {
                        type: 'direct_response',
                        data: { content: aiResponse || 'No response generated' }
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(directPayload)}\n\n`));
                    controller.close();
                    return;
                }

                if (aiResponse) {
                    const chunkPayload = {
                        type: 'ai_response_chunk',
                        data: { content: aiResponse }
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunkPayload)}\n\n`));
                }

                const completionPayload = {
                    type: 'ai_response_complete',
                    data: {
                        content: aiResponse || 'No response generated',
                        Items: pricingContext.Items,
                        filter: pricingContext.filter
                    }
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(completionPayload)}\n\n`));
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

export async function fetchPrices(filter: string) {
    const api_url = "https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview";
    let allItems: PricingItem[] = [];
    let nextPageUrl = `${api_url}&$filter=${filter}`;

    while (nextPageUrl) {
        const response = await fetch(nextPageUrl);
        if (!response.ok) {
            throw new Error('Failed to fetch prices');
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
        }
        nextPageUrl = data.NextPageLink || '';
    }

    return { Items: allItems };
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
