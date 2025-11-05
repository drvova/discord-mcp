import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { PromptInput } from "@/components/ui/prompt-input";
import { Send, Smile } from "lucide-react";
import { StickerPicker } from "@/components/sticker-picker/StickerPicker";
import {
    MentionAutocomplete,
    type MentionOption,
} from "@/components/MentionAutocomplete";
import type { DiscordEmoji, DiscordChannel } from "@/types";

interface InputAreaProps {
    onSendMessage: (message: string) => void;
    disabled?: boolean;
    guildId?: string;
    channelId?: string;
    availableChannels?: DiscordChannel[];
}

export function InputArea({
    onSendMessage,
    disabled,
    guildId,
    channelId,
    availableChannels = [],
}: InputAreaProps) {
    const [message, setMessage] = useState("");
    const [showPicker, setShowPicker] = useState(false);
    const [showMentions, setShowMentions] = useState(false);
    const [mentionFilter, setMentionFilter] = useState("");
    const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 });
    const [cursorPosition, setCursorPosition] = useState(0);
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

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        const cursorPos = e.target.selectionStart;

        setMessage(value);
        setCursorPosition(cursorPos);

        const textBeforeCursor = value.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\w*)$/);

        if (atMatch) {
            const filter = atMatch[1];
            setMentionFilter(filter);
            setShowMentions(true);

            if (inputRef.current) {
                const rect = inputRef.current.getBoundingClientRect();
                const textArea = inputRef.current;

                const lines = textBeforeCursor.split("\n");
                const currentLine = lines.length;
                const lineHeight = 24;

                setMentionPosition({
                    top:
                        rect.bottom -
                        (textArea.scrollHeight - currentLine * lineHeight),
                    left: rect.left + 10,
                });
            }
        } else {
            setShowMentions(false);
        }
    };

    const handleMentionSelect = (option: MentionOption) => {
        const textBeforeCursor = message.substring(0, cursorPosition);
        const textAfterCursor = message.substring(cursorPosition);

        const atIndex = textBeforeCursor.lastIndexOf("@");
        const newText =
            textBeforeCursor.substring(0, atIndex) +
            `@${option.name} ` +
            textAfterCursor;

        setMessage(newText);
        setShowMentions(false);

        setTimeout(() => {
            if (inputRef.current) {
                const newCursorPos = atIndex + option.name.length + 2;
                inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
                inputRef.current.focus();
            }
        }, 0);
    };

    const mentionOptions: MentionOption[] = [
        ...availableChannels.map((ch) => ({
            type: "channel" as const,
            id: ch.id,
            name: ch.name,
            displayName: `#${ch.name}`,
        })),
    ];

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

                        {showMentions && (
                            <MentionAutocomplete
                                options={mentionOptions}
                                position={mentionPosition}
                                filter={mentionFilter}
                                onSelect={handleMentionSelect}
                                onClose={() => setShowMentions(false)}
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
                                    onChange={handleChange}
                                    onSubmit={handleSubmit}
                                    placeholder="Ask me anything about your Discord server... (Type @ to mention channels)"
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
                    <span>for new line •</span>
                    <kbd className="px-1.5 py-0.5 text-[10px] font-semibold bg-muted border rounded">
                        @
                    </kbd>
                    <span>to mention</span>
                </p>
            </div>
        </div>
    );
}
