import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Bot, User, Zap } from "lucide-react";
import type { Message, ToolCall } from "@/types";

interface MessageBubbleProps {
    message: Message;
    toolCalls?: ToolCall[];
}

export function MessageBubble({ message, toolCalls = [] }: MessageBubbleProps) {
    const isUser = message.role === "user";

    return (
        <div className="flex gap-4 items-start">
            <Avatar className="h-10 w-10 border-2 flex-shrink-0">
                <AvatarFallback
                    className={
                        isUser
                            ? "bg-muted"
                            : "bg-primary text-primary-foreground"
                    }
                >
                    {isUser ? (
                        <User className="h-5 w-5" />
                    ) : (
                        <Bot className="h-5 w-5" />
                    )}
                </AvatarFallback>
            </Avatar>

            <div className="flex-1 space-y-3 min-w-0">
                <div className="font-semibold text-base">
                    {isUser ? "You" : "Discord MCP"}
                </div>

                <div className="text-sm leading-relaxed text-foreground/90">
                    {message.content.split("\n").map((line, i) => (
                        <p key={i} className="mb-3 last:mb-0">
                            {line || "\u00A0"}
                        </p>
                    ))}
                </div>

                {toolCalls.length > 0 && (
                    <div className="space-y-3 pt-2">
                        {toolCalls.map((tool, index) => (
                            <Card
                                key={index}
                                className="bg-muted/50 border-primary/20"
                            >
                                <div className="p-4 space-y-3">
                                    <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                                        <Zap className="h-4 w-4" />
                                        <span>{tool.function_name}</span>
                                    </div>
                                    <pre className="text-xs bg-background/50 rounded-md p-3 overflow-x-auto border">
                                        {JSON.stringify(tool.result, null, 2)}
                                    </pre>
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
