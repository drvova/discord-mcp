import { useState } from "react";
import type { Conversation, Message, ToolCall } from "@/types";
import { MESSAGE_PREVIEW_LENGTH } from "@/constants";

export function useConversations() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [currentId, setCurrentId] = useState<string | null>(null);

    const current = conversations.find((c) => c.id === currentId);

    const createConversation = (message: string): string => {
        const id = Date.now().toString();
        const title =
            message.substring(0, MESSAGE_PREVIEW_LENGTH) +
            (message.length > MESSAGE_PREVIEW_LENGTH ? "..." : "");

        setConversations((prev) => [
            ...prev,
            { id, title, messages: [], toolCalls: [] },
        ]);
        setCurrentId(id);
        return id;
    };

    const addMessage = (conversationId: string, message: Message) => {
        setConversations((prev) =>
            prev.map((c) =>
                c.id === conversationId
                    ? { ...c, messages: [...c.messages, message] }
                    : c,
            ),
        );
    };

    const addToolCalls = (conversationId: string, toolCalls: ToolCall[]) => {
        setConversations((prev) =>
            prev.map((c) =>
                c.id === conversationId
                    ? { ...c, toolCalls: [...(c.toolCalls || []), toolCalls] }
                    : c,
            ),
        );
    };

    const resetCurrent = () => setCurrentId(null);

    return {
        conversations,
        current,
        currentId,
        setCurrentId,
        createConversation,
        addMessage,
        addToolCalls,
        resetCurrent,
    };
}
