import { queryPricingWithStreamingResponse } from '@/lib/price-api';
import { NextRequest } from 'next/server';

export const maxDuration = 60; // Set max duration to 60 seconds

export async function POST(request: NextRequest) {
    try {
        const { prompt, previous_response_id } = await request.json();
        if (!prompt) {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }
        
        // 使用更新后的 queryPricing 函数，返回流式响应
        const stream = await queryPricingWithStreamingResponse(prompt, previous_response_id || undefined);
        
        // 返回流式响应
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    } catch (error) {
        console.error('Error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return Response.json(
            { 
                error: 'Failed to process request', 
                details: errorMessage,
                timestamp: new Date().toISOString()
            }, 
            { status: 500 }
        );
    }
}