import { queryPricingWithStreamingResponse } from '@/lib/price-api';
import { NextRequest } from 'next/server';

export const maxDuration = 60; // Set max duration to 60 seconds

export async function POST(request: NextRequest) {
    try {
        const { prompt, previous_response_id } = await request.json();
        if (!prompt) {
            return Response.json({ error: 'Prompt is required' }, { status: 400 });
        }
        
        // Use streaming response function
        // Pass previous_response_id to maintain single conversation thread
        // Agent will decide whether to call tools based on the query context
        const stream = await queryPricingWithStreamingResponse(prompt, previous_response_id || undefined);
        
        // Return streaming response with Azure Web App compatible headers
        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no', // Disable nginx buffering
                'Content-Encoding': 'none', // Prevent compression that can cause buffering
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