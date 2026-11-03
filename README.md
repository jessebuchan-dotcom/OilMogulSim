# Global Oil Mogul — Google AI Studio Build edition (No Firebase)

A teacher-controlled multiplayer oil market for CAIE AS/A2 Business. **Runs on a single Node.js server; no Firebase, Firestore, separate database, external API, Google sign-in or Gemini model calls.**

## Get this app into Google AI Studio

The reliable, officially documented import method is **GitHub Import**, not directly opening a ZIP as a running app.

1. Extract the supplied ZIP. **All application files are at the archive root** (`package.json`, `server.js`, `engine.js`, `public/`, `tests/`, etc.). Do not upload an extra enclosing folder to GitHub.
2. Create a repository in GitHub and upload the extracted contents, keeping the folder structure. A private repository is preferable.
3. Open [Google AI Studio — Build](https://aistudio.google.com/), choose a **Web app**, then click **Add files (+) → Import from GitHub** and select your repository. Google documents this workflow at [Build apps in Google AI Studio](https://ai.google.dev/gemini-api/docs/aistudio-build-mode).
4. Paste the full instructions from **`AI_STUDIO_BUILD_PROMPT.md`** into the AI Studio agent.
5. Confirm the **Node server** is running and that the preview loads `Global Oil Mogul`. If AI Studio offers ZIP/source-file upload in your interface, you may try importing this same archive and then using the prompt; direct ZIP-as-app import is not the documented primary method, so GitHub is the fallback.
6. Create a teacher room in the preview, join from a second tab/browser, and test bidding and market settlement. AI Studio also documents testing through **Share → Shared URL**. Sharing may involve Google-account access, depending on your AI Studio sharing settings. Publishing provides a public web app URL, subject to your account's deployment eligibility.

Google's documentation for [multiplayer app testing](https://ai.google.dev/gemini-api/docs/aistudio-fullstack) and [publishing](https://ai.google.dev/gemini-api/docs/aistudio-deploying) provides current details.

## How to use it in class

1. Select **TEACHER CONTROL → CREATE A NEW MARKET**, choose 4–12 rounds, and set a teacher password.
2. Give students the five-character room code / **COPY STUDENT JOIN LINK**. Students create a company or join an existing one with its private eight-character team code. Several students can share a company.
3. Select **START ROUND**, then let companies adjust their production, price, and quantity offered. Rival bids are confidential until the round closes.
4. Select **CLOSE / SETTLE** from the control panel. The server allocates up to **100 barrels** of global demand according to relative prices and available supply, then calculates market share, revenue, stock and profit.
5. After settlement, use **SAVE SESSION BACKUP** to download a `.json` recovery file. Store it on the teacher device, not in student-accessible folders. Continue into the next round.
6. To permit negotiation, select **OIL SUMMIT** for the next round. Cartel agreements are NOT automatically enforced.
7. Finish with the actual market results and industry-profit comparison; export CSV for discussion or analysis in Excel.

### Recover after the AI Studio server restarts

Because there is **no database**, live market state is held in server memory only.

1. In **TEACHER CONTROL**, choose **REJOIN A MARKET**, then **Server restarted? Restore a saved session backup**.
2. Select the most recent `global-oil-mogul-backup-XXXXX.json` file.
3. Enter the **original teacher password** and select **RESTORE CLASSROOM SESSION**.
4. The original room code and student team tokens remain valid if those students have retained their browser's local credentials. Other students can use their private company access codes to rejoin.

Backups include **confidential company access codes and authentication tokens**, as well as the teacher's salted password hash. Do not put backups into GitHub or share them with students. A saved backup contains only state at the time of export: decisions made afterwards will be lost if the server restarts.

## Important limitation: live server ≠ persistent database

- A **single AI Studio development server process** can share temporary game state between connected tabs/devices. The application polls `/api/state` about every 1.8 seconds. Local-browser storage only remembers each user's session token; it is not the market database.
- AI Studio published applications run on **Cloud Run**, and containers can restart or be scaled to multiple independent instances. Without shared persistence, those instances will have separate, inconsistent rooms. A memory-only build is **a classroom prototype**, not durable/high-availability multiplayer hosting. If Cloud Run instance limits are configurable for you, constrain it to a single instance, but even that **cannot guarantee no restarts**.
- **Manual backups are the recovery mechanism**, not automatic persistence. Test the entire class workflow before using it with 28 students, and keep the teacher backup file accessible.
- Google AI Studio may restrict how Shared URLs are accessed, and publishing availability or charges can vary by account and tier. **This package has not been imported into your AI Studio account or deployed by us.**

## Economic and classroom rules

- Demand cap: 100 barrels per round.
- Firms: up to 12 companies; multiple student devices may join the same company.
- Production: 0–70 barrels, with a $28/barrel production cost.
- Price: $30–$120/barrel.
- Offer: 0 to available stock (inventory plus current output).
- Costs: $2 per barrel of closing inventory plus a $45 fixed charge per company, per round.
- Allocation: price-sensitive weighted shares, `weight = (120 / price) ^ 4.5`, with offers as hard quantity limits and any unmet demand left unsold.
- Teacher decides when to open/settle rounds; 4, 6, 8, 10 or 12 rounds available. No automatic timers.
- Revenue, profit, cumulative totals, market share, carry-over stock, leaderboards and CSV exports are calculated on the server.
- Final analysis compares **actual** Independent and Oil Summit rounds, not a pre-scripted success for collusion.

This is a deliberately simplified model of market power and collusion: global oil demand is fixed rather than modelled as an elastic demand curve. The exercise illustrates producer incentives, not a full representation of real petroleum markets or legal advice.

## Local smoke test (optional)

You can verify the same package outside AI Studio using Node.js 20+:

```bash
npm run dev
# http://localhost:3000
```

Run the automatic tests with:

```bash
npm test
```

The source files are ordinary, editable JavaScript/HTML/CSS with **zero runtime npm dependencies**. `server.js` serves `public/` and its own `/api/` endpoints on the same origin. `PORT` is respected, for example `PORT=8080 npm start`.

## Package file map

| File | Purpose |
|---|---|
| `package.json` | AI Studio / Node scripts, no external dependencies |
| `server.js` | Single-process classroom sessions, teacher/team authentication, API, backup and restore |
| `engine.js` | Deterministic market allocation and profit calculations |
| `public/index.html` | Complete student/teacher interface |
| `public/styles.css` | Dark, single-screen desktop styling with mobile fallback |
| `public/app.js` | Interface state, polling, submissions, control-panel interactions |
| `metadata.json` | App name and description |
| `AI_STUDIO_BUILD_PROMPT.md` | Paste into Google AI Studio after importing |
| `tests/*.test.js` | Economic, API, multiplayer and restart/recovery tests |
