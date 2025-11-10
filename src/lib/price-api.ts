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
    // description: '根据传入的 OData 查询条件从 Azure 零售价格 API 中获取数据,并返回合并后的 JSON 记录列表,仅使用 armRegionName 与 armSkuName 进行模糊查询。',
    description: "Retrieve retail pricing information for Azure services, with filters by service name, region, currency, SKU, or price type. Useful for cost analysis and comparing Azure rates programmatically.",
  
    parameters: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                //description: "OData 查询条件,例如:armRegionName eq 'southcentralus' and contains(armSkuName, 'Redis')"
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
};

type PricingWorkflowResult = {
    aiResponse: string;
    pricingContext?: PricingContext;
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
    return [
        // {
        //     role: "system",
        //     content: [
        //         {
        //             type: "input_text",
        //             text: "你是Azure价格查询助手，如果用户询问Azure产品价格相关问题，必须先调用odata_query，才能够回复。如果用户询问其他问题，你可以委婉地拒绝。"
        //         }
        //     ]
        // },
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
                    text: `Azure region mapping: ${JSON.stringify(azureRegions)}`
                }
            ]
        },
        {
            role: "user",
            content: [
                {
                    type: "input_text",
                    text: `Azure virtual machine size context: ${JSON.stringify(azureVmSize)}`
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

async function executePricingWorkflow(prompt: string, hooks: PricingWorkflowHooks = {}): Promise<PricingWorkflowResult> {
    const client = getOpenAIClient();
    const model = getDeploymentName();
    const processedCalls = new Set<string>();
    let latestPricingContext: PricingContext | undefined;

    let response: Response = await client.responses.create({
        model,
        input: buildConversation(prompt),
        tools: [PRICE_QUERY_TOOL],
        reasoning: { effort: "low" }
    });

    while (true) {
        const toolCalls = extractUnprocessedToolCalls(response, processedCalls);

        if (toolCalls.length === 0) {
            break;
        }

        const toolOutputs: ResponseInput = [];

        for (const toolCall of toolCalls) {
            const queryFilter = parseQueryFilter(toolCall);
            const priceData = await fetchPrices(queryFilter);

            latestPricingContext = {
                Items: priceData.Items,
                filter: queryFilter
            };

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

        response = await client.responses.create({
            model,
            previous_response_id: response.id,
            input: toolOutputs,
            reasoning: { effort: "low" }
        });
    }

    const aiResponse = extractOutputText(response).trim();

    return {
        aiResponse,
        pricingContext: latestPricingContext
    };
}

export async function queryPricing(prompt: string): Promise<{ filter?: string, items?: PricingItem[], aiResponse: string }> {
    const { aiResponse, pricingContext } = await executePricingWorkflow(prompt);

    if (!pricingContext) {
        return {
            aiResponse: aiResponse || 'No response generated'
        };
    }

    return {
        filter: pricingContext.filter,
        items: pricingContext.Items,
        aiResponse: aiResponse || 'No response generated'
    };
}

export async function queryPricingWithStreamingResponse(prompt: string): Promise<ReadableStream> {
    const encoder = new TextEncoder();

    return new ReadableStream({
        async start(controller) {
            try {
                const { aiResponse, pricingContext } = await executePricingWorkflow(prompt, {
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

// 原来的 convertJsonToFilter 函数不再需要，直接使用 LLM 生成的 OData 查询

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
