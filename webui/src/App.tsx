import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { InputArea } from "@/components/InputArea";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversations, useChat } from "@/hooks";
import type { Message } from "@/types";

function App() {
    const {
        conversations,
        current,
        currentId,
        setCurrentId,
        createConversation,
        addMessage,
        addToolCalls,
        resetCurrent,
    } = useConversations();

    const { isProcessing, sendMessage } = useChat();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    const handleSendMessage = async (message: string) => {
        const userMessage: Message = { role: "user", content: message };
        const conversationId = currentId || createConversation(message);

        addMessage(conversationId, userMessage);

        await sendMessage(
            message,
            current?.messages || [userMessage],
            (response, toolCalls) => {
                addMessage(conversationId, {
                    role: "assistant",
                    content: response,
                });
                if (toolCalls.length) addToolCalls(conversationId, toolCalls);
            },
        );
    };

    return (
        <ThemeProvider defaultTheme="dark" storageKey="discord-mcp-theme">
            <div className="flex h-screen overflow-hidden bg-background">
                <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-background border-b flex items-center px-4 z-10">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                    <span className="ml-3 font-semibold">Discord MCP</span>
                </div>

                <Sidebar
                    conversations={conversations}
                    currentConversationId={currentId}
                    onNewChat={() => {
                        resetCurrent();
                        setSidebarOpen(false);
                    }}
                    onSelectConversation={(id) => {
                        setCurrentId(id);
                        setSidebarOpen(false);
                    }}
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />

                <div className="flex-1 flex flex-col pt-14 lg:pt-0">
                    <ChatArea
                        messages={current?.messages || []}
                        isProcessing={isProcessing}
                        toolCalls={current?.toolCalls || []}
                    />
                    <InputArea
                        onSendMessage={handleSendMessage}
                        disabled={isProcessing}
                    />
                </div>
            </div>
        </ThemeProvider>
    );
}

export default App;
