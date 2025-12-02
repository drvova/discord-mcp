# Complete API Actions Reference

## discord_execute Actions

### message
| Action | Params | Description |
|--------|--------|-------------|
| send | channelId, content, [embed, components] | Send message |
| edit | channelId, messageId, content | Edit message |
| delete | channelId, messageId | Delete message |
| bulk_delete | channelId, messageIds[] | Bulk delete (max 100) |
| pin | channelId, messageId | Pin message |
| unpin | channelId, messageId | Unpin message |
| react | channelId, messageId, emoji | Add reaction |
| unreact | channelId, messageId, emoji | Remove reaction |
| crosspost | channelId, messageId | Crosspost announcement |

### dm
| Action | Params | Description |
|--------|--------|-------------|
| send | userId, content | Send DM |
| edit | userId, messageId, content | Edit DM |
| delete | userId, messageId | Delete DM |

### channel
| Action | Params | Description |
|--------|--------|-------------|
| create | name, type, [topic, categoryId, userLimit, bitrate] | Create channel |
| edit | channelId, [name, topic, nsfw, rateLimitPerUser] | Edit channel |
| delete | channelId | Delete channel |
| move | channelId, categoryId | Move to category |
| set_position | channelId, position | Set position |
| set_positions | positions[{id, position}] | Bulk set positions |
| set_private | channelId, private, [allowedRoles] | Set privacy |

### role
| Action | Params | Description |
|--------|--------|-------------|
| create | name, [color, permissions, hoist, mentionable] | Create role |
| edit | roleId, [name, color, permissions] | Edit role |
| delete | roleId | Delete role |
| set_positions | positions[{id, position}] | Set role positions |
| add_to_member | roleId, memberId | Add role to member |
| remove_from_member | roleId, memberId | Remove role from member |

### member
| Action | Params | Description |
|--------|--------|-------------|
| edit | memberId, [nickname, roles, mute, deaf] | Edit member |
| kick | memberId, [reason] | Kick member |
| ban | memberId, [reason, deleteMessageDays] | Ban member |
| unban | userId | Unban user |
| timeout | memberId, duration, [reason] | Timeout member |

### server
| Action | Params | Description |
|--------|--------|-------------|
| edit | [name, icon, banner, description] | Edit server |
| edit_welcome_screen | enabled, [welcomeChannels, description] | Edit welcome |

### voice
| Action | Params | Description |
|--------|--------|-------------|
| join | channelId | Join voice channel |
| leave | - | Leave voice channel |
| play | url | Play audio |
| stop | - | Stop audio |
| set_volume | volume (0-100) | Set volume |

### moderation
| Action | Params | Description |
|--------|--------|-------------|
| create_automod_rule | name, triggerType, actions | Create auto-mod |
| edit_automod_rule | ruleId, [name, enabled, actions] | Edit auto-mod |
| delete_automod_rule | ruleId | Delete auto-mod |

### webhook
| Action | Params | Description |
|--------|--------|-------------|
| create | channelId, name, [avatar] | Create webhook |
| delete | webhookId | Delete webhook |
| send | webhookId, content, [username, avatarURL] | Send via webhook |

### event
| Action | Params | Description |
|--------|--------|-------------|
| create | name, scheduledStartTime, privacyLevel, entityType | Create event |
| edit | eventId, [name, description, scheduledStartTime] | Edit event |
| delete | eventId | Delete event |

### emoji
| Action | Params | Description |
|--------|--------|-------------|
| create | name, image (base64 or URL) | Create emoji |
| delete | emojiId | Delete emoji |

### sticker
| Action | Params | Description |
|--------|--------|-------------|
| create | name, description, tags, file | Create sticker |
| delete | stickerId | Delete sticker |

### invite
| Action | Params | Description |
|--------|--------|-------------|
| create | channelId, [maxAge, maxUses, temporary] | Create invite |
| delete | inviteCode | Delete invite |

---

## discord_query Resources

| Resource | Filters | Returns |
|----------|---------|---------|
| messages | channelId, limit, before, after | Message[] |
| pinned_messages | channelId | Message[] |
| attachments | channelId, messageId | Attachment[] |
| channels | type, categoryId | Channel[] |
| channel_structure | - | CategoryStructure[] |
| members | limit, query, role | Member[] |
| member | memberId | Member |
| roles | - | Role[] |
| server | - | ServerInfo |
| server_stats | - | ServerStats |
| events | - | Event[] |
| invites | - | Invite[] |
| webhooks | channelId | Webhook[] |
| emojis | - | Emoji[] |
| stickers | - | Sticker[] |
| automod_rules | - | AutoModRule[] |
| voice_connections | - | VoiceConnection[] |

---

## discord_batch

Execute multiple operations atomically:

```json
{
  "operations": [
    { "operation": "...", "action": "...", "params": {...} },
    { "operation": "...", "action": "...", "params": {...} }
  ]
}
```

Operations execute in order. If one fails, subsequent operations are skipped.
