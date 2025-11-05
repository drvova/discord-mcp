export interface Message {
    role: "user" | "assistant";
    content: string;
}

export interface ToolCall {
    tool_call_id: string;
    function_name: string;
    result: any;
}

export interface Conversation {
    id: string;
    title: string;
    messages: Message[];
    toolCalls?: ToolCall[][];
}

export interface ChatResponse {
    response: string;
    toolCalls: ToolCall[];
}

export interface ChatRequest {
    message: string;
    conversationHistory: Message[];
}
