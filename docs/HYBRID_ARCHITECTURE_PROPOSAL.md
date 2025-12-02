# Discord MCP + Skill 混合架構方案

## 問題分析

### 當前痛點
| 問題 | 現況 | 影響 |
|------|------|------|
| Token 消耗 | 93 個工具 ≈ 17,200 tokens | 佔用 context window 8.6% |
| 工具選擇準確度 | >50 工具時準確度下降 | Claude 選錯工具 |
| 載入方式 | 全量預載 | 無法按需使用 |

## 混合架構設計

### 核心理念
```
┌─────────────────────────────────────────────────────────┐
│                    Claude Context                        │
├─────────────────────────────────────────────────────────┤
│  Skill (漸進式披露)          │  MCP (精簡核心)            │
│  ├─ 元數據: ~100 tokens     │  ├─ 5-8 核心工具           │
│  ├─ 指令: 按需載入          │  └─ ~2,000 tokens          │
│  └─ 腳本: 不佔 context      │                            │
├─────────────────────────────────────────────────────────┤
│  總計: ~2,100 tokens (原本 17,200 tokens)               │
│  減少: 88% token 消耗                                   │
└─────────────────────────────────────────────────────────┘
```

### MCP 精簡版：僅保留核心工具

**從 93 個工具精簡為 5-8 個通用工具：**

```typescript
const CORE_TOOLS = [
  {
    name: 'discord_execute',
    description: 'Execute Discord API operations via code',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['message', 'channel', 'role', 'member', 'server', 'voice', 'moderation'],
          description: 'Operation category'
        },
        action: { type: 'string', description: 'Specific action to perform' },
        params: { type: 'object', description: 'Action parameters' }
      },
      required: ['operation', 'action', 'params']
    }
  },
  {
    name: 'discord_query',
    description: 'Query Discord data (read-only operations)',
    inputSchema: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: ['messages', 'channels', 'members', 'roles', 'server', 'events'],
          description: 'Resource to query'
        },
        filters: { type: 'object', description: 'Query filters' },
        limit: { type: 'number', description: 'Result limit' }
      },
      required: ['resource']
    }
  },
  {
    name: 'discord_batch',
    description: 'Execute multiple Discord operations atomically',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              operation: { type: 'string' },
              action: { type: 'string' },
              params: { type: 'object' }
            }
          }
        }
      },
      required: ['operations']
    }
  }
];
```

### Skill 結構設計

```
discord-skill/
├── SKILL.md                    # 主入口 (~100 tokens 元數據)
│
├── workflows/                  # 工作流程指令 (按需載入)
│   ├── messaging.md           # 訊息操作指南
│   ├── channel-management.md  # 頻道管理指南
│   ├── moderation.md          # 審核管理指南
│   ├── voice.md               # 語音功能指南
│   └── server-admin.md        # 伺服器管理指南
│
├── reference/                  # 參考資料 (僅在需要時讀取)
│   ├── api-actions.md         # 完整 action 列表
│   ├── permissions.md         # 權限對照表
│   └── error-codes.md         # 錯誤代碼說明
│
└── scripts/                    # 執行腳本 (不佔 context)
    ├── validate_params.py     # 參數驗證
    ├── format_response.py     # 回應格式化
    └── batch_operations.py    # 批次操作
```

### SKILL.md 設計

```markdown
---
name: discord-operations
description: Discord 伺服器管理與自動化操作指南
version: 2.0.0
triggers:
  - discord
  - 伺服器
  - 頻道
  - 訊息
  - 成員
---

# Discord 操作指南

此 Skill 教導如何使用精簡版 Discord MCP 進行伺服器管理。

## 快速開始

使用 `discord_execute` 執行操作，使用 `discord_query` 查詢資料。

## 操作分類

| 類別 | 說明 | 詳細指南 |
|------|------|----------|
| 訊息 | 發送、編輯、刪除訊息 | [workflows/messaging.md](workflows/messaging.md) |
| 頻道 | 創建、管理、組織頻道 | [workflows/channel-management.md](workflows/channel-management.md) |
| 審核 | 自動審核、權限管理 | [workflows/moderation.md](workflows/moderation.md) |
| 語音 | 語音頻道、音訊播放 | [workflows/voice.md](workflows/voice.md) |
| 伺服器 | 伺服器設定、統計 | [workflows/server-admin.md](workflows/server-admin.md) |

## 基本用法

### 發送訊息
```json
{
  "tool": "discord_execute",
  "params": {
    "operation": "message",
    "action": "send",
    "params": {
      "channelId": "123456789",
      "content": "Hello!"
    }
  }
}
```

### 查詢頻道列表
```json
{
  "tool": "discord_query",
  "params": {
    "resource": "channels",
    "filters": { "type": "text" }
  }
}
```

完整 action 列表請參考 [reference/api-actions.md](reference/api-actions.md)
```

## 實施計劃

### Phase 1: MCP 重構 (Week 1-2)

#### 1.1 創建統一執行層
```typescript
// src/core/UnifiedExecutor.ts
export class UnifiedExecutor {
  private actionMap: Map<string, ActionHandler>;

  async execute(operation: string, action: string, params: object) {
    const handler = this.actionMap.get(`${operation}.${action}`);
    if (!handler) throw new Error(`Unknown action: ${operation}.${action}`);
    return handler.execute(params);
  }
}
```

#### 1.2 重構工具定義
- 將 93 個工具映射到 5-8 個核心工具
- 保持向後兼容：舊工具名稱作為 action 參數

#### 1.3 更新 inputSchema
- 使用 JSON Schema 的 oneOf 或 anyOf
- 根據 operation 動態驗證 params

### Phase 2: Skill 創建 (Week 2-3)

#### 2.1 編寫 SKILL.md
- 簡潔的觸發詞和描述
- 分類操作指南的導航

#### 2.2 編寫 workflows
- 每個操作類別一個 markdown
- 包含常見用例和範例

#### 2.3 編寫 reference
- 完整的 action 映射表
- 權限和錯誤代碼參考

### Phase 3: 整合測試 (Week 3-4)

#### 3.1 Token 測量
- 測量新架構的實際 token 消耗
- 與原架構比較

#### 3.2 功能測試
- 確保所有原有功能正常運作
- 測試 Skill 的漸進式載入

#### 3.3 用戶體驗測試
- 驗證 Claude 能正確選擇工具
- 測試複雜工作流程

## 工具映射表

### 原有工具 → 新工具對照

| 原有工具 | 新工具調用方式 |
|---------|---------------|
| `send_message` | `discord_execute({ operation: 'message', action: 'send', ... })` |
| `edit_message` | `discord_execute({ operation: 'message', action: 'edit', ... })` |
| `delete_message` | `discord_execute({ operation: 'message', action: 'delete', ... })` |
| `read_messages` | `discord_query({ resource: 'messages', ... })` |
| `create_text_channel` | `discord_execute({ operation: 'channel', action: 'create', params: { type: 'text', ... } })` |
| `create_voice_channel` | `discord_execute({ operation: 'channel', action: 'create', params: { type: 'voice', ... } })` |
| `get_roles` | `discord_query({ resource: 'roles' })` |
| `create_role` | `discord_execute({ operation: 'role', action: 'create', ... })` |
| `bulk_delete_messages` | `discord_batch({ operations: [...] })` |
| ... | ... |

## 預期效果

### Token 消耗比較

| 架構 | 工具數 | Token 消耗 | 備註 |
|------|--------|-----------|------|
| 原有 MCP | 93 | ~17,200 | 全量載入 |
| 精簡 MCP | 5-8 | ~2,000 | 核心工具 |
| Skill 元數據 | - | ~100 | 漸進式 |
| **混合架構** | **5-8** | **~2,100** | **減少 88%** |

### 其他效益
1. **工具選擇準確度提升**: 工具數量 <10，Claude 選擇準確
2. **可維護性提升**: Skill 指令易於更新，不需重啟 MCP
3. **擴展性**: 新功能只需添加 Skill workflow，無需修改 MCP
4. **用戶體驗**: 通過 Skill 提供更好的使用指引

## 替代方案比較

| 方案 | Token 減少 | 複雜度 | 維護成本 |
|------|-----------|--------|---------|
| 僅合併工具 | 15-20% | 低 | 低 |
| Tool Search Tool | 85% | 中 | 中 |
| **MCP + Skill 混合** | **88%** | **中** | **低** |
| 純 Code Execution | 98% | 高 | 高 |

## 結論

MCP + Skill 混合架構是最佳平衡方案：
- 保留 MCP 的外部連接能力
- 利用 Skill 的漸進式披露減少 token
- 通過 Skill 提供結構化的使用指引
- 維護成本較低，易於迭代

## 參考資料

- [Anthropic: Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Anthropic: Equipping agents with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Claude Skills vs MCP Comparison](https://skywork.ai/blog/ai-agent/claude-skills-vs-mcp-vs-llm-tools-comparison-2025/)
- [Skill Authoring Best Practices](https://docs.claude.com/en/docs/agents-and-tools/agent-skills/best-practices)
