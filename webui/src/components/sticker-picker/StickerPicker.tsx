import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Smile, Sticker, Image, X, Search, Loader2 } from "lucide-react";
import {
    fetchEmojis,
    fetchStickers,
    searchTenorGifs,
    fetchFeaturedGifs,
} from "@/api/discord";
import type { DiscordEmoji, DiscordSticker, TenorGif } from "@/types";
import { cn } from "@/lib/utils";

interface StickerPickerProps {
    guildId: string;
    onSelect: (type: "emoji" | "sticker" | "gif", data: any) => void;
    onClose: () => void;
}

type Tab = "emoji" | "sticker" | "gif";

export function StickerPicker({
    guildId,
    onSelect,
    onClose,
}: StickerPickerProps) {
    const [activeTab, setActiveTab] = useState<Tab>("emoji");
    const [emojis, setEmojis] = useState<DiscordEmoji[]>([]);
    const [stickers, setStickers] = useState<DiscordSticker[]>([]);
    const [gifs, setGifs] = useState<TenorGif[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [emojiSearch, setEmojiSearch] = useState("");
    const [stickerSearch, setStickerSearch] = useState("");

    useEffect(() => {
        loadEmojis();
        loadStickers();
        loadFeaturedGifs();
    }, [guildId]);

    useEffect(() => {
        if (activeTab === "gif" && searchQuery) {
            const timer = setTimeout(() => {
                searchGifs(searchQuery);
            }, 300);
            return () => clearTimeout(timer);
        }
    }, [searchQuery, activeTab]);

    const loadEmojis = async () => {
        try {
            setLoading(true);
            const data = await fetchEmojis(guildId);
            setEmojis(data);
        } catch (error) {
            console.error("Failed to load emojis:", error);
        } finally {
            setLoading(false);
        }
    };

    const loadStickers = async () => {
        try {
            const data = await fetchStickers(guildId);
            setStickers(data);
        } catch (error) {
            console.error("Failed to load stickers:", error);
        }
    };

    const loadFeaturedGifs = async () => {
        try {
            const data = await fetchFeaturedGifs();
            setGifs(data);
        } catch (error) {
            console.error("Failed to load featured GIFs:", error);
        }
    };

    const searchGifs = async (query: string) => {
        if (!query.trim()) {
            loadFeaturedGifs();
            return;
        }

        try {
            setLoading(true);
            const data = await searchTenorGifs(query);
            setGifs(data);
        } catch (error) {
            console.error("Failed to search GIFs:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEmojis = emojis.filter((emoji) =>
        emoji.name.toLowerCase().includes(emojiSearch.toLowerCase()),
    );

    const filteredStickers = stickers.filter(
        (sticker) =>
            sticker.name.toLowerCase().includes(stickerSearch.toLowerCase()) ||
            sticker.description
                .toLowerCase()
                .includes(stickerSearch.toLowerCase()),
    );

    return (
        <Card className="absolute bottom-full mb-2 left-0 w-[420px] shadow-lg border-2">
            <div className="flex items-center justify-between p-3 border-b">
                <div className="flex gap-1">
                    <Button
                        variant={activeTab === "emoji" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("emoji")}
                    >
                        <Smile className="h-4 w-4 mr-1" />
                        Emojis
                    </Button>
                    <Button
                        variant={activeTab === "sticker" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("sticker")}
                    >
                        <Sticker className="h-4 w-4 mr-1" />
                        Stickers
                    </Button>
                    <Button
                        variant={activeTab === "gif" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setActiveTab("gif")}
                    >
                        <Image className="h-4 w-4 mr-1" />
                        GIFs
                    </Button>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-4 w-4" />
                </Button>
            </div>

            {activeTab === "emoji" && (
                <div className="p-3 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search emojis..."
                            value={emojiSearch}
                            onChange={(e) => setEmojiSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>
            )}

            {activeTab === "sticker" && (
                <div className="p-3 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search stickers..."
                            value={stickerSearch}
                            onChange={(e) => setStickerSearch(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>
            )}

            {activeTab === "gif" && (
                <div className="p-3 border-b">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search GIFs..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                </div>
            )}

            <ScrollArea className="h-96">
                <div className="p-3">
                    {activeTab === "emoji" && (
                        <EmojiGrid
                            emojis={filteredEmojis}
                            loading={loading}
                            searchQuery={emojiSearch}
                            onSelect={(emoji) => {
                                onSelect("emoji", emoji);
                                onClose();
                            }}
                        />
                    )}
                    {activeTab === "sticker" && (
                        <StickerGrid
                            stickers={filteredStickers}
                            loading={loading}
                            searchQuery={stickerSearch}
                            onSelect={(sticker) => {
                                onSelect("sticker", sticker);
                                onClose();
                            }}
                        />
                    )}
                    {activeTab === "gif" && (
                        <GifGrid
                            gifs={gifs}
                            loading={loading}
                            onSelect={(gif) => {
                                onSelect("gif", gif);
                                onClose();
                            }}
                        />
                    )}
                </div>
            </ScrollArea>
        </Card>
    );
}

function EmojiGrid({
    emojis,
    loading,
    searchQuery,
    onSelect,
}: {
    emojis: DiscordEmoji[];
    loading: boolean;
    searchQuery: string;
    onSelect: (emoji: DiscordEmoji) => void;
}) {
    if (loading) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                Loading emojis...
            </div>
        );
    }

    if (emojis.length === 0) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                {searchQuery
                    ? "No emojis found matching your search"
                    : "No custom emojis found"}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-8 gap-2">
            {emojis.map((emoji) => (
                <button
                    key={emoji.id}
                    onClick={() => onSelect(emoji)}
                    className={cn(
                        "aspect-square rounded-lg hover:bg-accent transition-colors",
                        "flex items-center justify-center group relative",
                    )}
                    title={emoji.name}
                >
                    <img
                        src={emoji.url}
                        alt={emoji.name}
                        className="w-8 h-8 object-contain"
                    />
                </button>
            ))}
        </div>
    );
}

function StickerGrid({
    stickers,
    loading,
    searchQuery,
    onSelect,
}: {
    stickers: DiscordSticker[];
    loading: boolean;
    searchQuery: string;
    onSelect: (sticker: DiscordSticker) => void;
}) {
    if (loading) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                Loading stickers...
            </div>
        );
    }

    if (stickers.length === 0) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                {searchQuery
                    ? "No stickers found matching your search"
                    : "No custom stickers found"}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-4 gap-3">
            {stickers.map((sticker) => (
                <button
                    key={sticker.id}
                    onClick={() => onSelect(sticker)}
                    className={cn(
                        "aspect-square rounded-lg hover:bg-accent transition-colors p-2",
                        "flex flex-col items-center justify-center group relative",
                    )}
                    title={`${sticker.name}\n${sticker.description}`}
                >
                    <img
                        src={sticker.url}
                        alt={sticker.name}
                        className="w-full h-full object-contain"
                    />
                    <span className="text-xs mt-1 truncate w-full text-center">
                        {sticker.name}
                    </span>
                </button>
            ))}
        </div>
    );
}

function GifGrid({
    gifs,
    loading,
    onSelect,
}: {
    gifs: TenorGif[];
    loading: boolean;
    onSelect: (gif: TenorGif) => void;
}) {
    if (loading) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2" />
                Searching GIFs...
            </div>
        );
    }

    if (gifs.length === 0) {
        return (
            <div className="text-center py-12 text-sm text-muted-foreground">
                No GIFs found
            </div>
        );
    }

    return (
        <div className="grid grid-cols-3 gap-2">
            {gifs.map((gif) => (
                <button
                    key={gif.id}
                    onClick={() => onSelect(gif)}
                    className={cn(
                        "rounded-lg overflow-hidden hover:ring-2 hover:ring-primary transition-all",
                        "aspect-square bg-muted group relative",
                    )}
                    title={gif.title}
                >
                    <img
                        src={gif.preview}
                        alt={gif.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                    />
                </button>
            ))}
        </div>
    );
}
