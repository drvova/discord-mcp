import { useState } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Sidebar } from "@/components/Sidebar";
import { ChatArea } from "@/components/ChatArea";
import { InputArea } from "@/components/InputArea";
import { DiscordPanel } from "@/components/DiscordPanel";
import { Menu, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConversations, useChat, useDiscord } from "@/hooks";
import type { Message, DiscordChannel } from "@/types";

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
    const {
        guilds,
        selectedGuildId,
        setSelectedGuildId,
        channelStructure,
        loading: discordLoading,
        refresh: refreshDiscord,
    } = useDiscord();

    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [discordPanelOpen, setDiscordPanelOpen] = useState(false);
    const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
        null,
    );

    const handleSendMessage = async (message: string) => {
        console.log("[App] handleSendMessage called with:", message);
        const userMessage: Message = { role: "user", content: message };
        const conversationId = currentId || createConversation(message);

        addMessage(conversationId, userMessage);

        const updatedHistory = [...(current?.messages || []), userMessage];
        console.log(
            "[App] Sending with history length:",
            updatedHistory.length,
        );

        await sendMessage(message, updatedHistory, (response, toolCalls) => {
            console.log(
                "[App] onSuccess callback called with response:",
                response.substring(0, 100),
            );
            addMessage(conversationId, {
                role: "assistant",
                content: response,
            });
            if (toolCalls.length) {
                console.log("[App] Adding tool calls:", toolCalls.length);
                addToolCalls(conversationId, toolCalls);
            }
        });
    };

    const handleQuickAction = (action: string, guildId: string) => {
        const actionMessages: Record<string, string> = {
            send_message: `Send a message to a channel in this server (${guildId})`,
            list_channels: `List all channels in this server (${guildId})`,
            server_info: `Get server information for ${guildId}`,
            manage: `Show me management options for this server (${guildId})`,
        };

        const message = actionMessages[action] || action;
        handleSendMessage(message);
        setDiscordPanelOpen(false);
    };

    const handleChannelClick = (channel: DiscordChannel) => {
        setSelectedChannelId(channel.id);
        const message = `Tell me about the #${channel.name} channel (ID: ${channel.id})`;
        handleSendMessage(message);
        setDiscordPanelOpen(false);
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
                    <div className="flex-1" />
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDiscordPanelOpen(!discordPanelOpen)}
                    >
                        <Server className="h-5 w-5" />
                    </Button>
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
                        guildId={selectedGuildId}
                        channelId={selectedChannelId}
                    />
                </div>

                <DiscordPanel
                    guilds={guilds}
                    selectedGuildId={selectedGuildId}
                    onSelectGuild={setSelectedGuildId}
                    channelStructure={channelStructure}
                    loading={discordLoading}
                    isOpen={discordPanelOpen}
                    onClose={() => setDiscordPanelOpen(false)}
                    onQuickAction={handleQuickAction}
                    onChannelClick={handleChannelClick}
                    onRefresh={refreshDiscord}
                />
            </div>
        </ThemeProvider>
    );
}

export default App;
