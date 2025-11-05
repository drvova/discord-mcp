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
        context?: {
            guildId?: string;
            guildName?: string;
            channelId?: string;
            channelName?: string;
            availableChannels?: Array<{
                id: string;
                name: string;
                type: string;
            }>;
        },
    ) => {
        if (isProcessing) {
            console.warn("[useChat] Already processing, ignoring request");
            return;
        }

        console.log("[useChat] Starting message send:", {
            message,
            historyLength: history.length,
        });
        setIsProcessing(true);
        try {
            const data = await sendChatMessage({
                message,
                conversationHistory: history.slice(-MAX_MESSAGE_HISTORY),
                context,
            });
            console.log("[useChat] Received response, calling onSuccess");
            onSuccess(data.response, data.toolCalls || []);
        } catch (error) {
            console.error("[useChat] Failed to send message:", error);
            onError?.(error as Error);
        } finally {
            console.log("[useChat] Setting isProcessing to false");
            setIsProcessing(false);
        }
    };

    return { isProcessing, sendMessage };
}
