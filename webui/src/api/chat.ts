import type { ChatRequest, ChatResponse } from "@/types";

export async function sendChatMessage(
    request: ChatRequest,
): Promise<ChatResponse> {
    console.log("[API] Sending chat message:", { message: request.message });

    const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
    });

    console.log("[API] Response status:", response.status);

    if (!response.ok) {
        const data = await response.json();
        console.error("[API] Error response:", data);
        throw new Error(data.error || "Failed to send message");
    }

    const data = await response.json();
    console.log("[API] Success response:", data);
    return data;
}
