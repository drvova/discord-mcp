import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";
import { Plus, MessageSquare, Moon, Sun, Settings, X } from "lucide-react";
import type { Conversation } from "@/types";
import { cn } from "@/lib/utils";

interface SidebarProps {
    conversations: Conversation[];
    currentConversationId: string | null;
    onNewChat: () => void;
    onSelectConversation: (id: string) => void;
    isOpen: boolean;
    onClose: () => void;
}

export function Sidebar({
    conversations,
    currentConversationId,
    onNewChat,
    onSelectConversation,
    isOpen,
    onClose,
}: SidebarProps) {
    const { theme, setTheme } = useTheme();

    return (
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 lg:hidden"
                    onClick={onClose}
                />
            )}

            <div
                className={cn(
                    "fixed lg:relative inset-y-0 left-0 z-50 w-72 bg-muted/40 border-r flex flex-col transition-transform lg:translate-x-0",
                    isOpen ? "translate-x-0" : "-translate-x-full",
                )}
            >
                <div className="p-4 border-b space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <MessageSquare className="h-4 w-4 text-primary" />
                            </div>
                            <span className="font-semibold text-base">
                                Discord MCP
                            </span>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={onClose}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    <Button
                        onClick={onNewChat}
                        className="w-full"
                        size="default"
                    >
                        <Plus className="mr-2 h-4 w-4" />
                        New Conversation
                    </Button>
                </div>

                <ScrollArea className="flex-1 px-3">
                    <div className="space-y-2 py-4">
                        {conversations.map((conv) => (
                            <button
                                key={conv.id}
                                onClick={() => onSelectConversation(conv.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-4 py-3 text-sm rounded-lg transition-all text-left group",
                                    currentConversationId === conv.id
                                        ? "bg-primary/10 text-primary font-medium border border-primary/20"
                                        : "hover:bg-accent/50",
                                )}
                            >
                                <MessageSquare className="h-4 w-4 flex-shrink-0 opacity-70 group-hover:opacity-100" />
                                <span className="truncate">{conv.title}</span>
                            </button>
                        ))}
                        {conversations.length === 0 && (
                            <div className="text-center py-12 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                    No conversations yet
                                </p>
                                <p className="text-xs text-muted-foreground/70">
                                    Start a new chat to begin
                                </p>
                            </div>
                        )}
                    </div>
                </ScrollArea>

                <div className="p-4 border-t space-y-2">
                    <Button
                        variant="ghost"
                        size="default"
                        className="w-full justify-start hover:bg-accent"
                        onClick={() =>
                            setTheme(theme === "dark" ? "light" : "dark")
                        }
                    >
                        {theme === "dark" ? (
                            <>
                                <Sun className="mr-3 h-4 w-4" />
                                <span>Light mode</span>
                            </>
                        ) : (
                            <>
                                <Moon className="mr-3 h-4 w-4" />
                                <span>Dark mode</span>
                            </>
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="default"
                        className="w-full justify-start hover:bg-accent"
                    >
                        <Settings className="mr-3 h-4 w-4" />
                        <span>Settings</span>
                    </Button>
                </div>
            </div>
        </>
    );
}
