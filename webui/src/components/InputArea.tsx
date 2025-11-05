import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/ui/prompt-input";
import { Send, Smile } from "lucide-react";
import { StickerPicker } from "@/components/sticker-picker/StickerPicker";
import type { DiscordEmoji } from "@/types";

interface InputAreaProps {
    onSendMessage: (message: string) => void;
    disabled?: boolean;
    guildId?: string;
    channelId?: string;
}

export function InputArea({
    onSendMessage,
    disabled,
    guildId,
    channelId,
}: InputAreaProps) {
    const [message, setMessage] = useState("");
    const [showPicker, setShowPicker] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const handleSend = () => {
        if (!message.trim() || disabled) return;

        onSendMessage(message);
        setMessage("");

        if (inputRef.current) {
            inputRef.current.style.height = "auto";
        }
    };

    const handleSubmit = (value: string) => {
        if (!disabled && value.trim()) {
            onSendMessage(value);
            setMessage("");
        }
    };

    const handleEmojiSelect = (emoji: DiscordEmoji) => {
        setMessage((prev) => prev + emoji.usage);

        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    return (
        <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="max-w-4xl mx-auto px-6 py-4">
                <div className="flex gap-3 items-end">
                    <div className="flex-1 relative">
                        {guildId && showPicker && (
                            <StickerPicker
                                guildId={guildId}
                                channelId={channelId}
                                onSelectEmoji={handleEmojiSelect}
                                onClose={() => setShowPicker(false)}
                            />
                        )}

                        <div className="flex items-end gap-2">
                            {guildId && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => setShowPicker(!showPicker)}
                                    className="mb-3 flex-shrink-0"
                                    type="button"
                                    title={
                                        channelId
                                            ? "Add emoji, sticker, or GIF"
                                            : "Select a channel to send stickers and GIFs"
                                    }
                                >
                                    <Smile className="h-5 w-5" />
                                </Button>
                            )}

                            <div className="flex-1 relative">
                                <PromptInput
                                    ref={inputRef}
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    onSubmit={handleSubmit}
                                    placeholder="Ask me anything about your Discord server..."
                                    disabled={disabled}
                                    className="pr-14 shadow-sm"
                                />
                                <Button
                                    onClick={handleSend}
                                    disabled={!message.trim() || disabled}
                                    size="icon"
                                    className="absolute bottom-3 right-3 h-9 w-9 rounded-lg"
                                >
                                    <Send className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-3 flex items-center justify-center gap-1">
                    <span>Press</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-muted border rounded">
                        Enter
                    </kbd>
                    <span>to send •</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-muted border rounded">
                        Shift + Enter
                    </kbd>
                    <span>for new line</span>
                </p>
            </div>
        </div>
    );
}
