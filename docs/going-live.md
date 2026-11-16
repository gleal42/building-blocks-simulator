# Going live: the buyer's app and real unlock codes

Right now the customer side of the app is a **preview**. Every pack is a "box on the table"
with one sample code, and nothing leaves your browser. This page lists what is needed to sell
for real, in the order to do it. Each step is small; ask Claude to do the code parts.

## What going live means

1. **A buyer's app on the web**: the customer side on its own (My packs, Play alone, Play
   together), without the Maker side and without the "boxes on the table".
2. **The packs inside it**: the ones you sell, so the app can show them once unlocked.
3. **One unlock code per box**: printed on the unlock card, with a QR code that opens the app
   and unlocks the pack.
4. **A way for the app to check a code**: one of the two setups below.

The buyer never makes an account. An unlocked pack stays on their device. On a new phone, they
scan the card again.

## Choose a setup

| | **A. Pack files, no server** (start here) | **B. A database** (later) |
|---|---|---|
| How a code works | Each sold pack ships inside the app, scrambled (encrypted). A box's code unscrambles it. | The app sends the code to a small online database. The database answers with the pack. |
| Cost | Free (static hosting only) | Free to start; a paid plan to stay always on (see below) |
| Upkeep | None | Keep the project running |
| Adding packs or codes | Rebuild and publish the app | Add rows in the database; no rebuild |
| Stop a code that was shared online | No | Yes |
| See how many boxes were unlocked | No | Yes |

**A** is the right start: nothing can go down, and a shared code only gives away cards, not the
puzzle itself (the tray and the pieces). Move to **B** when you sell enough to want numbers, or
if codes start circulating.

### A. Pack files, no server

The code for this already exists. It was built and tested, then set aside for the preview: it
is in the `full-version` branch (`src/lock.js` and `tests/sell.test.js`).

1. **Packs to sell.** Make them in the Packs tab. Ask Claude to add them to `packs/`: it reads
   your saved packs.
2. **Lock them.** Claude brings back `src/lock.js` as a small script:
   `npm run lock -- packs/animals.json --codes 200`. It writes the locked pack (for the app) and
   `codes-animals.csv` (for you, **never** for the app or the repository).
3. **The buyer's app.** Claude adds a build of the customer side alone (`npm run build` writes
   `buyer.html` next to `index.html`) that opens `#u-CODE` links and unlocks with the locked packs.
4. **Publish it**, see [Hosting](#hosting).
5. **Print the unlock cards.** Print › Unlock card: set *Where buyers open the app* to the
   published address, then *Open a list of codes* with `codes-animals.csv`, and save the PDF.
   One card per box.
6. **Keep the codes file safe** (a password manager or a private drive). Without it you cannot
   reprint a lost card.

### B. A database

Supabase (a hosted Postgres database) fits: a free plan to start, and the app can call it
directly from the browser. Nothing else is needed on the server.

- **Tables:** `packs` (id, name, rows, cols, designs as JSON), `codes` (code, pack_id, batch,
  created_at, unlocks, max_unlocks, disabled).
- **One function**, `redeem(code)`: checks the code, counts the unlock, returns the pack. Buyers
  can only call this function; they cannot read the tables. Row-level security is on and there
  are no table permissions for the public role.
- **The app:** My packs calls `redeem` instead of reading locked files. Everything else stays
  the same.
- **Codes:** made in the database for each batch, exported as CSV, then printed as in A, step 5.

Watch out: on Supabase's Free plan, a project that gets too little database activity over a
week is paused until you resume it, and buyers could not unlock while it is paused. Projects on
paid plans are never paused
([Supabase](https://supabase.com/kb/faqs/platform/free-project-pausing), checked 16 Nov 2026).
So use B on a paid plan, or keep the project busy.

## Hosting

The buyer's app is one HTML file, so any static host works.

- **GitHub Pages** is free for public repositories. For a private repository it needs a paid
  plan (GitHub Pro)
  ([GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans),
  checked 16 Nov 2026). You plan to make this repository private, so either pay for Pro or use
  another host.
- **Netlify** or **Cloudflare Pages** can publish from a private repository. Check their
  current free plans.
- A domain of your own (for example `notan.pt`) makes the QR codes shorter and lasts if you
  change hosts. Buy it before printing the unlock cards: the address is printed in every QR
  code.

## Before printing a batch

- The address in *Where buyers open the app* is final: it is inside every QR code.
- Scan a printed unlock card with two different phones.
- Unlock it, play a card alone, and start a game together.
- Keep the codes file of the batch.
- Your details are on the box and the rules (Print › Box). Check what your packaging has to
  show where you sell.
