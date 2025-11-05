# Discord MCP Web UI - Vite + React + shadcn/ui

A modern, professional web interface for Discord MCP built with Vite, React, TypeScript, and shadcn/ui components.

## 🚀 Tech Stack

- **Vite** - Lightning-fast build tool
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **shadcn/ui** - Beautiful, accessible components
- **Radix UI** - Unstyled, accessible primitives
- **Lucide Icons** - Beautiful icon set

## ✨ Features

- 🎨 **Beautiful UI** - ChatGPT-inspired design with shadcn/ui
- 🌓 **Dark/Light Mode** - Seamless theme switching
- 📱 **Fully Responsive** - Mobile-first design
- 💾 **Conversation History** - Persistent chat storage
- ⚡ **Real-time Updates** - Instant message rendering
- 🎯 **Type-Safe** - Full TypeScript coverage
- 🔧 **Tool Execution** - Visual Discord operation results

## 📦 Installation

```bash
cd webui
npm install
```

## 🏃 Development

### Full Stack Development (Recommended)
From the **root directory** (`discord-mcp/`):
```bash
# Start both backend API and frontend UI
npm run dev:fullstack
```

This runs:
- **Backend**: `http://localhost:3000` - Express server with Discord & Groq AI
- **Frontend**: `http://localhost:3001` - Vite dev server with HMR

Open `http://localhost:3001` in your browser to use the UI.

### Frontend Only
From the **webui directory**:
```bash
# Start dev server (requires backend running separately)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

**Note**: The frontend proxies `/api` requests to `http://localhost:3000`, so make sure the backend server is running.

## 🏗️ Project Structure

```
webui/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── scroll-area.tsx
│   │   │   ├── textarea.tsx
│   │   │   └── avatar.tsx
│   │   ├── ChatArea.tsx     # Main chat interface
│   │   ├── Sidebar.tsx      # Navigation sidebar
│   │   ├── InputArea.tsx    # Message input
│   │   └── theme-provider.tsx
│   ├── lib/
│   │   └── utils.ts         # Utility functions
│   ├── App.tsx              # Main app component
│   ├── main.tsx             # Entry point
│   └── index.css            # Global styles + Tailwind
├── public/                  # Static assets
├── index.html
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## 🎨 Component Overview

### Sidebar
- New chat button
- Conversation history list
- Theme toggle (dark/light)
- Settings access
- Responsive mobile menu

### ChatArea
- Welcome screen with examples
- Message bubbles (user/assistant)
- Tool execution display
- Typing indicators
- Auto-scroll to latest

### InputArea
- Auto-resizing textarea
- Send button
- Keyboard shortcuts (Enter to send)
- Character limit handling

## 🎯 Key Components

### UI Components (shadcn/ui)

All components follow shadcn/ui patterns:

```tsx
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Avatar } from "@/components/ui/avatar"
```

### Theme System

```tsx
import { useTheme } from "@/components/theme-provider"

const { theme, setTheme } = useTheme()
setTheme("dark") // or "light" or "system"
```

### State Management

```tsx
// Conversation state
const [conversations, setConversations] = useState<Conversation[]>([])
const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
const [isProcessing, setIsProcessing] = useState(false)
```

## 🔧 Configuration

### Vite Config

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': 'http://localhost:3000' // Backend server
    }
  }
})
```

### Tailwind Config

Using shadcn/ui's recommended Tailwind setup with CSS variables for theming.

### TypeScript Config

Strict mode enabled with path aliases:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

## 🎨 Customization

### Colors

Edit CSS variables in `src/index.css`:

```css
:root {
  --primary: 160 84% 39%;  /* Groq green */
  --background: 0 0% 100%;
  /* ... */
}

.dark {
  --primary: 160 84% 39%;
  --background: 222.2 84% 4.9%;
  /* ... */
}
```

### Adding shadcn/ui Components

```bash
# Install any shadcn/ui component
npx shadcn-ui@latest add [component-name]

# Example:
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add dropdown-menu
```

## 🚀 Building for Production

```bash
# Build
npm run build

# Output: dist/
# - dist/index.html
# - dist/assets/*.js (optimized)
# - dist/assets/*.css (optimized)
```

### Deployment

The build output is static files. Deploy to:
- **Vercel**: `vercel deploy`
- **Netlify**: Drag & drop `dist/`
- **GitHub Pages**: Upload `dist/`
- **Any static host**

## 🔌 API Integration

The frontend connects to the backend via `/api/chat`:

```tsx
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message,
    conversationHistory
  })
})
```

Vite dev server proxies to `http://localhost:3000` (backend).

## 📱 Responsive Breakpoints

```css
/* Mobile: default */
/* Tablet: 768px */
@media (min-width: 768px) { }

/* Desktop: 1024px */
@media (min-width: 1024px) { }
```

## 🎯 Best Practices

1. **Component Organization**: Keep components small and focused
2. **Type Safety**: Always type props and state
3. **Accessibility**: Use semantic HTML and ARIA labels
4. **Performance**: Lazy load heavy components
5. **Theming**: Use CSS variables for consistency

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Change port in vite.config.ts
server: {
  port: 3002  // or any other port
}
```

### Build Errors

```bash
# Clear cache
rm -rf node_modules dist
npm install
npm run build
```

### API Connection Issues

Check backend is running:
```bash
# Terminal 1: Backend
cd ..
npm run web

# Terminal 2: Frontend
cd webui
npm run dev
```

## 📚 Resources

- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Radix UI Primitives](https://www.radix-ui.com/)

## 🎓 Learn More

- **Vite**: https://vitejs.dev/guide/
- **React Hooks**: https://react.dev/reference/react
- **TypeScript**: https://www.typescriptlang.org/docs/
- **shadcn/ui**: https://ui.shadcn.com/docs
- **Tailwind**: https://tailwindcss.com/docs

## 📄 License

MIT

---

**Built with ❤️ using Vite + React + shadcn/ui**
