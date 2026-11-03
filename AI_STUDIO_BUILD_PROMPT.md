# COPY INTO GOOGLE AI STUDIO BUILD

> **Use this after importing the project's files into a new Google AI Studio Build web app.** The code is already written. Do not ask the model to regenerate it from scratch.

---

Treat the imported project as the authoritative, completed **Global Oil Mogul** multiplayer classroom simulation. RUN and TEST these existing files rather than redesigning them.

- **No Firebase. No Firestore. No database, sign-in provider, Supabase or other third-party service.** The app deliberately uses a shared in-memory Node.js server (`server.js`) for temporary classroom sessions, and teacher-managed `.json` session backup/restore.
- Use the **full-stack Web app with a Node.js server**. At the project root, the `package.json` scripts are `npm run dev` and `npm start`; both start `server.js`. The server binds `0.0.0.0` on `process.env.PORT` (default 3000), serves `public/`, and handles `/api/*` requests. Use the existing server as the single HTTP entrypoint. Do not replace it with a browser-only SPA or a separate Vite dev server that steals the port.
- The existing files are `server.js` (authoritative rooms/authentication/API), `engine.js` (deterministic 100-barrel market calculations), `public/index.html`, `public/app.js`, `public/styles.css`, `package.json`, and `tests/`.
- Preserve every existing student and teacher workflow: room code, private company join codes, confidential price/production/offer decisions, teacher-controlled opening and settlement, switching between Independent and Oil Summit rounds, the live leaderboard, final debrief, CSV export and **Save Session Backup / Restore Saved Session**.
- The **same Node.js process must serve all connected players**. Do not move state into `localStorage` per student, where devices cannot share a market. Student `localStorage` is only used to remember their own access credentials.
- Maintain existing visual design, single-screen laptop layout, world exchange, interaction facilities, language, and underlying teaching assumptions. No redesign, generic cards, external images, new intro pages, fake backend, mandatory Gemini API requests or timed rounds.
- Run `npm test` and confirm the engine, multi-client API lifecycle, permissions, and backup→restart→restore tests. Preview the app in multiple browser sessions. Check that two companies can bid privately, that a teacher can close the market, and that all screens see the same result.
- Tell me clearly which tests were actually executed. If the AI Studio preview expects a different start command, update only the environment configuration needed to launch `node server.js` without changing simulation behaviour.

**Important deployment note:** server memory is volatile. The teacher must download a private session backup after each round. A process/container restart can erase active rooms until a backup is restored. Separately scaled Cloud Run instances do not share memory; **do not claim the published app provides reliable cross-instance multiplayer or durable persistence without external storage**. For real classroom use, keep a single backend instance where configurable, rehearse the backup workflow, and use a single shared application URL. Do not secretly add Firebase or another database to solve this limitation.

Once ready, report the preview/share URL only if AI Studio actually provides it. Do not invent a hosted URL.
