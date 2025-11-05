import { DiscordService } from "../discord-service.js";
import * as schemas from "../types.js";

export class AutomationManager {
    private discordService: DiscordService;

    constructor(discordService: DiscordService) {
        this.discordService = discordService;
    }

    async executeAction(action: string, params: any): Promise<string> {
        const methodName = action.replace(/_([a-z])/g, (g) =>
            g[1].toUpperCase(),
        );

        if (typeof (this as any)[methodName] === "function") {
            return await (this as any)[methodName](...Object.values(params));
        }

        throw new Error(
            `Method '${methodName}' not found in AutomationManager`,
        );
    }

    async switchToken(tokenType: string, token?: string): Promise<string> {
        const parsed = schemas.SwitchTokenSchema.parse({ tokenType, token });
        return await this.discordService.switchToken(parsed);
    }

    async getAuthStatus(includeDetails?: boolean): Promise<string> {
        const parsed = schemas.GetAuthStatusSchema.parse({ includeDetails });
        const status = this.discordService.getAuthStatus();

        const authDetails = {
            tokenType: status.tokenType,
            isReady: status.isReady,
            userTag: status.userTag,
            permissions: status.permissions,
        };

        if (includeDetails) {
            return `**Current Authentication Status:**
  - **Token Type**: ${authDetails.tokenType}
  - **Ready Status**: ${authDetails.isReady ? "✅ Connected" : "❌ Not Connected"}
  - **User**: ${authDetails.userTag || "Unknown"}
  - **Permissions**: ${authDetails.permissions.join(", ")}

  **Configuration**: ${JSON.stringify(this.discordService.getCurrentAuthConfig(), null, 2)}`;
        }

        return `Authentication: ${authDetails.tokenType} | Status: ${authDetails.isReady ? "Connected" : "Not Connected"} | User: ${authDetails.userTag || "Unknown"}`;
    }

    // Server Management
    async getServerInfo(guildId?: string): Promise<string> {
        const parsed = schemas.ServerInfoSchema.parse({ guildId });
        return await this.discordService.getServerInfo(parsed.guildId);
    }

    async editServer(
        guildId: string,
        name?: string,
        description?: string,
        icon?: string,
        banner?: string,
        verificationLevel?: string,
    ): Promise<string> {
        const parsed = schemas.EditServerSchema.parse({
            guildId,
            name,
            description,
            icon,
            banner,
            verificationLevel,
        });
        return await this.discordService.editServer(
            parsed.guildId,
            parsed.name,
            parsed.description,
            parsed.icon,
            parsed.banner,
            parsed.verificationLevel,
        );
    }

    async getServerStats(guildId?: string): Promise<string> {
        const parsed = schemas.GetServerStatsSchema.parse({ guildId });
        return await this.discordService.getServerStats(parsed.guildId);
    }

    async getServerWidget(guildId: string): Promise<string> {
        const parsed = schemas.GetServerWidgetSchema.parse({ guildId });
        return await this.discordService.getServerWidget(parsed.guildId);
    }

    async getWelcomeScreen(guildId: string): Promise<string> {
        const parsed = schemas.GetWelcomeScreenSchema.parse({ guildId });
        return await this.discordService.getWelcomeScreen(parsed.guildId);
    }

    async editWelcomeScreen(
        guildId: string,
        enabled?: boolean,
        description?: string,
        welcomeChannels?: any[],
    ): Promise<string> {
        const parsed = schemas.EditWelcomeScreenSchema.parse({
            guildId,
            enabled,
            description,
            welcomeChannels,
        });
        return await this.discordService.editWelcomeScreen(
            parsed.guildId,
            parsed.enabled,
            parsed.description,
            parsed.welcomeChannels,
        );
    }

    // Message Management
    async sendMessage(channelId: string, message: string): Promise<string> {
        const parsed = schemas.SendMessageSchema.parse({ channelId, message });
        return await this.discordService.sendMessage(
            parsed.channelId,
            parsed.message,
        );
    }

    async editMessage(
        channelId: string,
        messageId: string,
        newMessage: string,
    ): Promise<string> {
        const parsed = schemas.EditMessageSchema.parse({
            channelId,
            messageId,
            newMessage,
        });
        return await this.discordService.editMessage(
            parsed.channelId,
            parsed.messageId,
            parsed.newMessage,
        );
    }

    async deleteMessage(channelId: string, messageId: string): Promise<string> {
        const parsed = schemas.DeleteMessageSchema.parse({
            channelId,
            messageId,
        });
        return await this.discordService.deleteMessage(
            parsed.channelId,
            parsed.messageId,
        );
    }

    async readMessages(channelId: string, count?: string): Promise<string> {
        const parsed = schemas.ReadMessagesSchema.parse({ channelId, count });
        return await this.discordService.readMessages(
            parsed.channelId,
            parsed.count,
        );
    }

    async pinMessage(channelId: string, messageId: string): Promise<string> {
        const parsed = schemas.PinMessageSchema.parse({ channelId, messageId });
        return await this.discordService.pinMessage(
            parsed.channelId,
            parsed.messageId,
        );
    }

    async unpinMessage(channelId: string, messageId: string): Promise<string> {
        const parsed = schemas.UnpinMessageSchema.parse({
            channelId,
            messageId,
        });
        return await this.discordService.unpinMessage(
            parsed.channelId,
            parsed.messageId,
        );
    }

    async getPinnedMessages(channelId: string): Promise<string> {
        const parsed = schemas.GetPinnedMessagesSchema.parse({ channelId });
        return await this.discordService.getPinnedMessages(parsed.channelId);
    }

    async bulkDeleteMessages(
        channelId: string,
        messageIds: string[],
        filterOld?: boolean,
    ): Promise<string> {
        const parsed = schemas.BulkDeleteMessagesSchema.parse({
            channelId,
            messageIds,
            filterOld,
        });
        return await this.discordService.bulkDeleteMessages(
            parsed.channelId,
            parsed.messageIds,
            parsed.filterOld,
        );
    }

    async crosspostMessage(
        channelId: string,
        messageId: string,
    ): Promise<string> {
        const parsed = schemas.CrosspostMessageSchema.parse({
            channelId,
            messageId,
        });
        return await this.discordService.crosspostMessage(
            parsed.channelId,
            parsed.messageId,
        );
    }

    async addReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<string> {
        const parsed = schemas.AddReactionSchema.parse({
            channelId,
            messageId,
            emoji,
        });
        return await this.discordService.addReaction(
            parsed.channelId,
            parsed.messageId,
            parsed.emoji,
        );
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
    ): Promise<string> {
        const parsed = schemas.RemoveReactionSchema.parse({
            channelId,
            messageId,
            emoji,
        });
        return await this.discordService.removeReaction(
            parsed.channelId,
            parsed.messageId,
            parsed.emoji,
        );
    }

    // Private Message Management
    async getUserIdByName(username: string, guildId?: string): Promise<string> {
        const parsed = schemas.GetUserIdByNameSchema.parse({
            username,
            guildId,
        });
        return await this.discordService.getUserIdByName(
            parsed.username,
            parsed.guildId,
        );
    }

    async sendPrivateMessage(userId: string, message: string): Promise<string> {
        const parsed = schemas.SendPrivateMessageSchema.parse({
            userId,
            message,
        });
        return await this.discordService.sendPrivateMessage(
            parsed.userId,
            parsed.message,
        );
    }

    async editPrivateMessage(
        userId: string,
        messageId: string,
        newMessage: string,
    ): Promise<string> {
        const parsed = schemas.EditPrivateMessageSchema.parse({
            userId,
            messageId,
            newMessage,
        });
        return await this.discordService.editPrivateMessage(
            parsed.userId,
            parsed.messageId,
            parsed.newMessage,
        );
    }

    async deletePrivateMessage(
        userId: string,
        messageId: string,
    ): Promise<string> {
        const parsed = schemas.DeletePrivateMessageSchema.parse({
            userId,
            messageId,
        });
        return await this.discordService.deletePrivateMessage(
            parsed.userId,
            parsed.messageId,
        );
    }

    async readPrivateMessages(userId: string, count?: string): Promise<string> {
        const parsed = schemas.ReadPrivateMessagesSchema.parse({
            userId,
            count,
        });
        return await this.discordService.readPrivateMessages(
            parsed.userId,
            parsed.count,
        );
    }

    // Channel Management
    async createTextChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
    ): Promise<string> {
        const parsed = schemas.CreateTextChannelSchema.parse({
            guildId,
            name,
            categoryId,
        });
        return await this.discordService.createTextChannel(
            parsed.guildId,
            parsed.name,
            parsed.categoryId,
        );
    }

    async createVoiceChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        userLimit?: number,
        bitrate?: number,
    ): Promise<string> {
        const parsed = schemas.CreateVoiceChannelSchema.parse({
            guildId,
            name,
            categoryId,
            userLimit,
            bitrate,
        });
        return await this.discordService.createVoiceChannel(
            parsed.guildId,
            parsed.name,
            parsed.categoryId,
            parsed.userLimit,
            parsed.bitrate,
        );
    }

    async createForumChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: any,
    ): Promise<string> {
        const parsed = schemas.CreateForumChannelSchema.parse({
            guildId,
            name,
            categoryId,
            ...options,
        });
        return await this.discordService.createForumChannel(
            parsed.guildId,
            parsed.name,
            parsed.categoryId,
            {
                topic: parsed.topic,
                slowmode: parsed.slowmode,
                defaultReactionEmoji: parsed.defaultReactionEmoji,
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
            },
        );
    }

    async createAnnouncementChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: any,
    ): Promise<string> {
        const parsed = schemas.CreateAnnouncementChannelSchema.parse({
            guildId,
            name,
            categoryId,
            ...options,
        });
        return await this.discordService.createAnnouncementChannel(
            parsed.guildId,
            parsed.name,
            parsed.categoryId,
            {
                topic: parsed.topic,
                slowmode: parsed.slowmode,
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
            },
        );
    }

    async createStageChannel(
        guildId: string | undefined,
        name: string,
        categoryId?: string,
        options?: any,
    ): Promise<string> {
        const parsed = schemas.CreateStageChannelSchema.parse({
            guildId,
            name,
            categoryId,
            ...options,
        });
        return await this.discordService.createStageChannel(
            parsed.guildId,
            parsed.name,
            parsed.categoryId,
            {
                topic: parsed.topic,
                bitrate: parsed.bitrate,
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
            },
        );
    }

    async editChannelAdvanced(
        guildId: string | undefined,
        channelId: string,
        options: any,
    ): Promise<string> {
        const parsed = schemas.EditChannelAdvancedSchema.parse({
            guildId,
            channelId,
            ...options,
        });
        return await this.discordService.editChannelAdvanced(
            parsed.guildId,
            parsed.channelId,
            {
                name: parsed.name,
                topic: parsed.topic,
                slowmode: parsed.slowmode,
                userLimit: parsed.userLimit,
                bitrate: parsed.bitrate,
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
                categoryId: parsed.categoryId,
            },
        );
    }

    async deleteChannel(
        guildId: string | undefined,
        channelId: string,
    ): Promise<string> {
        const parsed = schemas.DeleteChannelSchema.parse({
            guildId,
            channelId,
        });
        return await this.discordService.deleteChannel(
            parsed.guildId,
            parsed.channelId,
        );
    }

    async findChannel(
        guildId: string | undefined,
        channelName: string,
    ): Promise<string> {
        const parsed = schemas.FindChannelSchema.parse({
            guildId,
            channelName,
        });
        return await this.discordService.findChannel(
            parsed.guildId,
            parsed.channelName,
        );
    }

    async listChannels(guildId?: string): Promise<string> {
        const parsed = schemas.ListChannelsSchema.parse({ guildId });
        return await this.discordService.listChannels(parsed.guildId);
    }

    async setChannelPosition(
        guildId: string | undefined,
        channelId: string,
        position: number,
    ): Promise<string> {
        const parsed = schemas.SetChannelPositionSchema.parse({
            guildId,
            channelId,
            position,
        });
        return await this.discordService.setChannelPosition(
            parsed.guildId,
            parsed.channelId,
            parsed.position,
        );
    }

    async setChannelPositions(
        guildId: string | undefined,
        channelPositions: Array<{ channelId: string; position: number }>,
    ): Promise<string> {
        const parsed = schemas.SetChannelPositionsSchema.parse({
            guildId,
            channelPositions,
        });
        return await this.discordService.setChannelPositions(
            parsed.guildId,
            parsed.channelPositions,
        );
    }

    async moveChannelToCategory(
        guildId: string | undefined,
        channelId: string,
        categoryId: string | null,
    ): Promise<string> {
        const parsed = schemas.MoveChannelToCategorySchema.parse({
            guildId,
            channelId,
            categoryId,
        });
        return await this.discordService.moveChannelToCategory(
            parsed.guildId,
            parsed.channelId,
            parsed.categoryId,
        );
    }

    async setCategoryPosition(
        guildId: string | undefined,
        categoryId: string,
        position: number,
    ): Promise<string> {
        const parsed = schemas.SetCategoryPositionSchema.parse({
            guildId,
            categoryId,
            position,
        });
        return await this.discordService.setCategoryPosition(
            parsed.guildId,
            parsed.categoryId,
            parsed.position,
        );
    }

    async organizeChannels(
        guildId: string | undefined,
        organization: any,
    ): Promise<string> {
        const parsed = schemas.OrganizeChannelsSchema.parse({
            guildId,
            organization,
        });
        return await this.discordService.organizeChannels(
            parsed.guildId,
            parsed.organization,
        );
    }

    async getChannelStructure(guildId?: string): Promise<string> {
        const parsed = schemas.GetChannelStructureSchema.parse({ guildId });
        return await this.discordService.getChannelStructure(parsed.guildId);
    }

    // Category Management
    async createCategory(
        guildId: string | undefined,
        name: string,
    ): Promise<string> {
        const parsed = schemas.CreateCategorySchema.parse({ guildId, name });
        return await this.discordService.createCategory(
            parsed.guildId,
            parsed.name,
        );
    }

    async deleteCategory(
        guildId: string | undefined,
        categoryId: string,
    ): Promise<string> {
        const parsed = schemas.DeleteCategorySchema.parse({
            guildId,
            categoryId,
        });
        return await this.discordService.deleteCategory(
            parsed.guildId,
            parsed.categoryId,
        );
    }

    async findCategory(
        guildId: string | undefined,
        categoryName: string,
    ): Promise<string> {
        const parsed = schemas.FindCategorySchema.parse({
            guildId,
            categoryName,
        });
        return await this.discordService.findCategory(
            parsed.guildId,
            parsed.categoryName,
        );
    }

    async listChannelsInCategory(
        guildId: string | undefined,
        categoryId: string,
    ): Promise<string> {
        const parsed = schemas.ListChannelsInCategorySchema.parse({
            guildId,
            categoryId,
        });
        return await this.discordService.listChannelsInCategory(
            parsed.guildId,
            parsed.categoryId,
        );
    }

    // Privacy Management
    async setChannelPrivate(
        guildId: string | undefined,
        channelId: string,
        options: any,
    ): Promise<string> {
        const parsed = schemas.SetChannelPrivateSchema.parse({
            guildId,
            channelId,
            ...options,
        });
        return await this.discordService.setChannelPrivate(
            parsed.guildId,
            parsed.channelId,
            {
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
                allowedMembers: parsed.allowedMembers,
                syncToCategory: parsed.syncToCategory,
            },
        );
    }

    async setCategoryPrivate(
        guildId: string | undefined,
        categoryId: string,
        options: any,
    ): Promise<string> {
        const parsed = schemas.SetCategoryPrivateSchema.parse({
            guildId,
            categoryId,
            ...options,
        });
        return await this.discordService.setCategoryPrivate(
            parsed.guildId,
            parsed.categoryId,
            {
                isPrivate: parsed.isPrivate,
                allowedRoles: parsed.allowedRoles,
                allowedMembers: parsed.allowedMembers,
                applyToChannels: parsed.applyToChannels,
            },
        );
    }

    async bulkSetPrivacy(
        guildId: string | undefined,
        targets: Array<any>,
    ): Promise<string> {
        const parsed = schemas.BulkSetPrivacySchema.parse({ guildId, targets });
        return await this.discordService.bulkSetPrivacy(
            parsed.guildId,
            parsed.targets,
        );
    }

    async comprehensiveChannelManagement(
        guildId: string | undefined,
        operations: any[],
    ): Promise<string> {
        const parsed = schemas.ComprehensiveChannelManagementSchema.parse({
            guildId,
            operations,
        });
        return await this.discordService.comprehensiveChannelManagement(
            parsed.guildId,
            parsed.operations,
        );
    }

    // Webhook Management
    async createWebhook(channelId: string, name: string): Promise<string> {
        const parsed = schemas.CreateWebhookSchema.parse({ channelId, name });
        return await this.discordService.createWebhook(
            parsed.channelId,
            parsed.name,
        );
    }

    async deleteWebhook(webhookId: string): Promise<string> {
        const parsed = schemas.DeleteWebhookSchema.parse({ webhookId });
        return await this.discordService.deleteWebhook(parsed.webhookId);
    }

    async listWebhooks(channelId: string): Promise<string> {
        const parsed = schemas.ListWebhooksSchema.parse({ channelId });
        return await this.discordService.listWebhooks(parsed.channelId);
    }

    async sendWebhookMessage(
        webhookUrl: string,
        message: string,
    ): Promise<string> {
        const parsed = schemas.SendWebhookMessageSchema.parse({
            webhookUrl,
            message,
        });
        return await this.discordService.sendWebhookMessage(
            parsed.webhookUrl,
            parsed.message,
        );
    }

    // Role Management
    async createRole(
        guildId: string | undefined,
        name: string,
        color?: string,
        permissions?: string[],
    ): Promise<string> {
        const parsed = schemas.CreateRoleSchema.parse({
            guildId,
            name,
            color,
            permissions,
        });
        return await this.discordService.createRole(
            parsed.name,
            parsed.guildId,
            parsed.color,
            parsed.permissions,
        );
    }

    async deleteRole(
        guildId: string | undefined,
        roleId: string,
    ): Promise<string> {
        const parsed = schemas.DeleteRoleSchema.parse({ guildId, roleId });
        return await this.discordService.deleteRole(
            parsed.roleId,
            parsed.guildId,
        );
    }

    async editRole(
        guildId: string | undefined,
        roleId: string,
        name?: string,
        color?: string,
        permissions?: string[],
    ): Promise<string> {
        const parsed = schemas.EditRoleSchema.parse({
            guildId,
            roleId,
            name,
            color,
            permissions,
        });
        return await this.discordService.editRole(
            parsed.roleId,
            parsed.guildId,
            parsed.name,
            parsed.color,
            parsed.permissions,
        );
    }

    async addRoleToMember(
        guildId: string | undefined,
        userId: string,
        roleId: string,
    ): Promise<string> {
        const parsed = schemas.AddRoleToMemberSchema.parse({
            guildId,
            userId,
            roleId,
        });
        return await this.discordService.addRoleToMember(
            parsed.userId,
            parsed.roleId,
            parsed.guildId,
        );
    }

    async removeRoleFromMember(
        guildId: string | undefined,
        userId: string,
        roleId: string,
    ): Promise<string> {
        const parsed = schemas.RemoveRoleFromMemberSchema.parse({
            guildId,
            userId,
            roleId,
        });
        return await this.discordService.removeRoleFromMember(
            parsed.userId,
            parsed.roleId,
            parsed.guildId,
        );
    }

    async getRoles(guildId?: string): Promise<string> {
        const parsed = schemas.GetRolesSchema.parse({ guildId });
        return await this.discordService.getRoles(parsed.guildId);
    }

    async setRolePositions(
        guildId: string | undefined,
        rolePositions: Array<{ roleId: string; position: number }>,
    ): Promise<string> {
        const parsed = schemas.SetRolePositionsSchema.parse({
            guildId,
            rolePositions,
        });
        return await this.discordService.setRolePositions(
            parsed.guildId,
            parsed.rolePositions,
        );
    }

    // Member Management
    async getMembers(
        guildId?: string,
        limit?: number,
        after?: string,
    ): Promise<string> {
        const parsed = schemas.GetMembersSchema.parse({
            guildId,
            limit,
            after,
        });
        return await this.discordService.getMembers(
            parsed.guildId,
            parsed.limit,
            parsed.after,
        );
    }

    async searchMembers(
        guildId?: string,
        query?: string,
        limit?: number,
    ): Promise<string> {
        const parsed = schemas.SearchMembersSchema.parse({
            guildId,
            query,
            limit,
        });
        return await this.discordService.searchMembers(
            parsed.guildId,
            parsed.query,
            parsed.limit,
        );
    }

    async editMember(
        guildId?: string,
        userId?: string,
        nickname?: string,
        roles?: string[],
    ): Promise<string> {
        const parsed = schemas.EditMemberSchema.parse({
            guildId,
            userId,
            nickname,
            roles,
        });
        return await this.discordService.editMember(
            parsed.guildId,
            parsed.userId,
            parsed.nickname,
            parsed.roles,
        );
    }

    async getMemberInfo(guildId?: string, userId?: string): Promise<string> {
        const parsed = schemas.GetMemberInfoSchema.parse({ guildId, userId });
        return await this.discordService.getMemberInfo(
            parsed.guildId,
            parsed.userId,
        );
    }

    // Voice & Audio Management
    async joinVoiceChannel(
        guildId: string,
        channelId: string,
    ): Promise<string> {
        const parsed = schemas.JoinVoiceChannelSchema.parse({
            guildId,
            channelId,
        });
        return await this.discordService.joinVoiceChannel(
            parsed.guildId,
            parsed.channelId,
        );
    }

    async leaveVoiceChannel(
        guildId: string,
        channelId: string,
    ): Promise<string> {
        const parsed = schemas.LeaveVoiceChannelSchema.parse({
            guildId,
            channelId,
        });
        return await this.discordService.leaveVoiceChannel(
            parsed.guildId,
            parsed.channelId,
        );
    }

    async playAudio(guildId: string, audioUrl: string): Promise<string> {
        const parsed = schemas.PlayAudioSchema.parse({ guildId, audioUrl });
        return await this.discordService.playAudio(
            parsed.guildId,
            parsed.audioUrl,
        );
    }

    async stopAudio(guildId: string): Promise<string> {
        const parsed = schemas.StopAudioSchema.parse({ guildId });
        return await this.discordService.stopAudio(parsed.guildId);
    }

    async setVolume(guildId: string, volume: number): Promise<string> {
        const parsed = schemas.SetVolumeSchema.parse({ guildId, volume });
        return await this.discordService.setVolume(
            parsed.guildId,
            parsed.volume,
        );
    }

    async getVoiceConnections(): Promise<string> {
        const parsed = schemas.GetVoiceConnectionsSchema.parse({});
        return await this.discordService.getVoiceConnections();
    }

    // Event Management
    async createEvent(
        guildId?: string,
        name?: string,
        description?: string,
        startTime?: string,
        endTime?: string,
        location?: string,
        channelId?: string,
    ): Promise<string> {
        const parsed = schemas.CreateEventSchema.parse({
            guildId,
            name,
            description,
            startTime,
            endTime,
            location,
            channelId,
        });
        return await this.discordService.createEvent(
            parsed.guildId,
            parsed.name,
            parsed.description,
            parsed.startTime,
            parsed.endTime,
            parsed.location,
            parsed.channelId,
        );
    }

    async editEvent(
        guildId?: string,
        eventId?: string,
        name?: string,
        description?: string,
        startTime?: string,
        endTime?: string,
        location?: string,
    ): Promise<string> {
        const parsed = schemas.EditEventSchema.parse({
            guildId,
            eventId,
            name,
            description,
            startTime,
            endTime,
            location,
        });
        return await this.discordService.editEvent(
            parsed.guildId,
            parsed.eventId,
            parsed.name,
            parsed.description,
            parsed.startTime,
            parsed.endTime,
            parsed.location,
        );
    }

    async deleteEvent(guildId?: string, eventId?: string): Promise<string> {
        const parsed = schemas.DeleteEventSchema.parse({ guildId, eventId });
        return await this.discordService.deleteEvent(
            parsed.guildId,
            parsed.eventId,
        );
    }

    async getEvents(guildId?: string): Promise<string> {
        const parsed = schemas.GetEventsSchema.parse({ guildId });
        return await this.discordService.getEvents(parsed.guildId);
    }

    // Invite Management
    async createInvite(
        channelId?: string,
        maxAge?: number,
        maxUses?: number,
        temporary?: boolean,
    ): Promise<string> {
        const parsed = schemas.CreateInviteSchema.parse({
            channelId,
            maxAge,
            maxUses,
            temporary,
        });
        return await this.discordService.createInvite(
            parsed.channelId,
            parsed.maxAge,
            parsed.maxUses,
            parsed.temporary,
        );
    }

    async deleteInvite(inviteCode?: string): Promise<string> {
        const parsed = schemas.DeleteInviteSchema.parse({ inviteCode });
        return await this.discordService.deleteInvite(parsed.inviteCode);
    }

    async getInvites(guildId?: string): Promise<string> {
        const parsed = schemas.GetInvitesSchema.parse({ guildId });
        return await this.discordService.getInvites(parsed.guildId);
    }

    // Emoji & Sticker Management
    async createEmoji(
        guildId?: string,
        name?: string,
        imageUrl?: string,
        roles?: string[],
    ): Promise<string> {
        const parsed = schemas.CreateEmojiSchema.parse({
            guildId,
            name,
            imageUrl,
            roles,
        });
        return await this.discordService.createEmoji(
            parsed.guildId,
            parsed.name,
            parsed.imageUrl,
            parsed.roles,
        );
    }

    async deleteEmoji(guildId?: string, emojiId?: string): Promise<string> {
        const parsed = schemas.DeleteEmojiSchema.parse({ guildId, emojiId });
        return await this.discordService.deleteEmoji(
            parsed.guildId,
            parsed.emojiId,
        );
    }

    async getEmojis(guildId?: string): Promise<string> {
        const parsed = schemas.GetEmojisSchema.parse({ guildId });
        return await this.discordService.getEmojis(parsed.guildId);
    }

    async createSticker(
        guildId?: string,
        name?: string,
        description?: string,
        tags?: string,
        imageUrl?: string,
    ): Promise<string> {
        const parsed = schemas.CreateStickerSchema.parse({
            guildId,
            name,
            description,
            tags,
            imageUrl,
        });
        return await this.discordService.createSticker(
            parsed.guildId,
            parsed.name,
            parsed.description,
            parsed.tags,
            parsed.imageUrl,
        );
    }

    async deleteSticker(guildId?: string, stickerId?: string): Promise<string> {
        const parsed = schemas.DeleteStickerSchema.parse({
            guildId,
            stickerId,
        });
        return await this.discordService.deleteSticker(
            parsed.guildId,
            parsed.stickerId,
        );
    }

    async getStickers(guildId?: string): Promise<string> {
        const parsed = schemas.GetStickersSchema.parse({ guildId });
        return await this.discordService.getStickers(parsed.guildId);
    }

    // Attachment & File Management
    async uploadFile(
        channelId?: string,
        filePath?: string,
        fileName?: string,
        content?: string,
    ): Promise<string> {
        const parsed = schemas.UploadFileSchema.parse({
            channelId,
            filePath,
            fileName,
            content,
        });
        return await this.discordService.uploadFile(
            parsed.channelId,
            parsed.filePath,
            parsed.fileName,
            parsed.content,
        );
    }

    async getMessageAttachments(
        channelId?: string,
        messageId?: string,
    ): Promise<string> {
        const parsed = schemas.GetMessageAttachmentsSchema.parse({
            channelId,
            messageId,
        });
        return await this.discordService.getMessageAttachments(
            parsed.channelId,
            parsed.messageId,
        );
    }

    async readImages(
        channelId: string,
        messageId?: string,
        limit?: number,
        includeMetadata?: boolean,
        downloadImages?: boolean,
    ): Promise<string> {
        const parsed = schemas.ReadImagesSchema.parse({
            channelId,
            messageId,
            limit,
            includeMetadata,
            downloadImages,
        });
        return await this.discordService.readImages(
            parsed.channelId,
            parsed.messageId,
            parsed.limit,
            parsed.includeMetadata,
            parsed.downloadImages,
        );
    }

    // Automod Management
    async createAutomodRule(
        guildId?: string,
        name?: string,
        eventType?: string,
        triggerType?: string,
        keywordFilter?: string[],
        presets?: string[],
        allowList?: string[],
        mentionLimit?: number,
        enabled?: boolean,
    ): Promise<string> {
        const parsed = schemas.CreateAutomodRuleSchema.parse({
            guildId,
            name,
            eventType,
            triggerType,
            keywordFilter,
            presets,
            allowList,
            mentionLimit,
            enabled,
        });
        return await this.discordService.createAutomodRule(
            parsed.guildId,
            parsed.name,
            parsed.eventType,
            parsed.triggerType,
            parsed.keywordFilter,
            parsed.presets,
            parsed.allowList,
            parsed.mentionLimit,
            parsed.enabled,
        );
    }

    async editAutomodRule(
        guildId?: string,
        ruleId?: string,
        name?: string,
        enabled?: boolean,
        keywordFilter?: string[],
        allowList?: string[],
        mentionLimit?: number,
    ): Promise<string> {
        const parsed = schemas.EditAutomodRuleSchema.parse({
            guildId,
            ruleId,
            name,
            enabled,
            keywordFilter,
            allowList,
            mentionLimit,
        });
        return await this.discordService.editAutomodRule(
            parsed.guildId,
            parsed.ruleId,
            parsed.name,
            parsed.enabled,
            parsed.keywordFilter,
            parsed.allowList,
            parsed.mentionLimit,
        );
    }

    async deleteAutomodRule(
        guildId?: string,
        ruleId?: string,
    ): Promise<string> {
        const parsed = schemas.DeleteAutomodRuleSchema.parse({
            guildId,
            ruleId,
        });
        return await this.discordService.deleteAutomodRule(
            parsed.guildId,
            parsed.ruleId,
        );
    }

    async getAutomodRules(guildId?: string): Promise<string> {
        const parsed = schemas.GetAutomodRulesSchema.parse({ guildId });
        return await this.discordService.getAutomodRules(parsed.guildId);
    }

    // Advanced Interaction Tools
    async sendModal(
        interactionId?: string,
        title?: string,
        customId?: string,
        components?: any[],
    ): Promise<string> {
        // This is a conceptual implementation as modals require active interaction context
        throw new Error(
            "Send modal functionality requires an active interaction context. This tool is designed for bot applications with slash commands or button interactions.",
        );
    }

    async sendEmbed(
        channelId?: string,
        title?: string,
        description?: string,
        color?: string,
        fields?: any[],
        footer?: string,
        image?: string,
        thumbnail?: string,
    ): Promise<string> {
        const parsed = schemas.SendEmbedSchema.parse({
            channelId,
            title,
            description,
            color,
            fields,
            footer,
            image,
            thumbnail,
        });
        return await this.discordService.sendEmbed(
            parsed.channelId,
            parsed.title,
            parsed.description,
            parsed.color,
            parsed.fields,
            parsed.footer,
            parsed.image,
            parsed.thumbnail,
        );
    }

    async sendButton(
        channelId?: string,
        content?: string,
        buttons?: any[],
    ): Promise<string> {
        const parsed = schemas.SendButtonSchema.parse({
            channelId,
            content,
            buttons,
        });
        return await this.discordService.sendButton(
            parsed.channelId,
            parsed.content,
            parsed.buttons,
        );
    }

    async sendSelectMenu(
        channelId?: string,
        content?: string,
        customId?: string,
        placeholder?: string,
        minValues?: number,
        maxValues?: number,
        options?: any[],
    ): Promise<string> {
        const parsed = schemas.SendSelectMenuSchema.parse({
            channelId,
            content,
            customId,
            placeholder,
            minValues,
            maxValues,
            options,
        });
        return await this.discordService.sendSelectMenu(
            parsed.channelId,
            parsed.content,
            parsed.customId,
            parsed.placeholder,
            parsed.minValues,
            parsed.maxValues,
            parsed.options,
        );
    }

    // Analytics & Logging
    async getMessageHistory(
        channelId?: string,
        limit?: number,
        before?: string,
        after?: string,
    ): Promise<string> {
        const parsed = schemas.GetMessageHistorySchema.parse({
            channelId,
            limit,
            before,
            after,
        });
        return await this.discordService.getMessageHistory(
            parsed.channelId,
            parsed.limit,
            parsed.before,
            parsed.after,
        );
    }

    async exportChatLog(
        channelId?: string,
        format?: string,
        limit?: number,
        dateRange?: any,
    ): Promise<string> {
        const parsed = schemas.ExportChatLogSchema.parse({
            channelId,
            format,
            limit,
            dateRange,
        });
        return await this.discordService.exportChatLog(
            parsed.channelId,
            parsed.format,
            parsed.limit,
            parsed.dateRange,
        );
    }
}
