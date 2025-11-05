import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Bot } from "lucide-react";

export function LoadingIndicator() {
    return (
        <div className="flex gap-4 items-start">
            <Avatar className="h-10 w-10 border-2">
                <AvatarFallback className="bg-primary text-primary-foreground">
                    <Bot className="h-5 w-5" />
                </AvatarFallback>
            </Avatar>
            <div className="flex-1 pt-2">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2.5 h-2.5 bg-primary rounded-full animate-bounce" />
                </div>
            </div>
        </div>
    );
}
