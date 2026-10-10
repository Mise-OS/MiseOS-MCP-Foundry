# MiseOS Easy Starter

Zero npm dependencies. Requires Node.js 20+.

## Start in 4 steps

```bash
cd examples/easy-starter
cp .env.example .env
# add your OPENROUTER_API_KEY to .env
npm start
```

Windows PowerShell:

```powershell
cd examples/easy-starter
Copy-Item .env.example .env
# add your OPENROUTER_API_KEY to .env
npm start
```

Run a task directly:

```bash
npm start -- "Design a secure MCP mutation gateway"
```

Run without any API key:

```bash
npm run demo
```

Run the full local verification gate:

```bash
npm run verify
```

Default team:

```text
Mise Maestro → Mise Garde → Mise Apprentice → Mise Sommelier → Human Pass
```

A card key cannot mint controller authority. A controller token cannot forge a card receipt. Team consensus remains advisory and never grants repository writes.
