import type { ChatRequest, ChatResponse } from "@/types";

export async function sendChatMessage(
    request: ChatRequest,
): Promise<ChatResponse> {
    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to send message");
    }

    return response.json();
}
