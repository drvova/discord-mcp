import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState, MessageBubble, LoadingIndicator } from "@/components/chat";
import type { Message, ToolCall } from "@/types";

interface ChatAreaProps {
    messages: Message[];
    isProcessing: boolean;
    toolCalls: ToolCall[][];
}

export function ChatArea({ messages, isProcessing, toolCalls }: ChatAreaProps) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isProcessing]);

    if (messages.length === 0 && !isProcessing) {
        return <EmptyState />;
    }

    return (
        <ScrollArea className="flex-1" ref={scrollRef}>
            <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
                {messages.map((message, index) => (
                    <MessageBubble
                        key={index}
                        message={message}
                        toolCalls={
                            message.role === "assistant"
                                ? toolCalls[Math.floor(index / 2)]
                                : []
                        }
                    />
                ))}
                {isProcessing && <LoadingIndicator />}
            </div>
        </ScrollArea>
    );
}
