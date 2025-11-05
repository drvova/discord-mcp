import { useState } from "react";
import { sendChatMessage } from "@/api/chat";
import type { Message } from "@/types";
import { MAX_MESSAGE_HISTORY } from "@/constants";

export function useChat() {
    const [isProcessing, setIsProcessing] = useState(false);

    const sendMessage = async (
        message: string,
        history: Message[],
        onSuccess: (response: string, toolCalls: any[]) => void,
        onError?: (error: Error) => void,
    ) => {
        if (isProcessing) return;

        setIsProcessing(true);
        try {
            const data = await sendChatMessage({
                message,
                conversationHistory: history.slice(-MAX_MESSAGE_HISTORY),
            });
            onSuccess(data.response, data.toolCalls || []);
        } catch (error) {
            console.error("Failed to send message:", error);
            onError?.(error as Error);
        } finally {
            setIsProcessing(false);
        }
    };

    return { isProcessing, sendMessage };
}
