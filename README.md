# GameBreaker

Browser-console tools for automating repetitive actions in *Magic University*
(https://hooks.rhysfuller.com/), a client-side React game. Since the game
runs entirely in your browser and this environment can't reach the site over
the network, these tools are plain JavaScript you paste into the browser's
DevTools console — they act on the page using your own logged-in session.

## Tools

### `console-tools/hire-professors.js`

Automates the "On the market" hiring section, Faculty tenure, and Capital
projects repairs on the Action page, graduating students from the Term
page, professor standing orders and mission parties from the Today page,
and material purchasing from the Week page.

**Usage:**
1. Open the game, log in, and go to the relevant page (Action page for hiring/tenure/passing/repairing, Term page for graduating, Today page for standing orders/parties, Week page for stock purchasing).
2. Open DevTools (F12) → Console tab.
3. Paste the entire contents of `console-tools/hire-professors.js` and press Enter.
4. Run one of:
   - `MU.status()` — reports current gold, lists market candidates (flagging Scribes), and lists faculty who aren't tenured yet.
   - `MU.hireScribes()` — hires every candidate on the market with the Scribe attribute.
   - `MU.hireAll()` — hires every candidate on the market.
   - `MU.tenureAll()` — tenures every hired professor who isn't tenured yet.
   - `MU.passAll()` — passes on every remaining candidate on the market, faster than the built-in "Pass over all" button.
   - `MU.graduateYear6()` — graduates every student tagged "yr 6" in the Students list (Term page).
   - `MU.setAllRecruit()` — sets every professor's standing order to "recruit" (Today page, under "The Chancellor's time").
   - `MU.setResearch(fraction)` — sets that fraction of professors (0-1) to "research"; `MU.setResearch(0.1)` for a tenth, `MU.setResearch(1)` for everyone.
   - `MU.setTeaching(fraction)` — sets that fraction (0-1) of professors *not currently on "research"* to "teach"; `MU.setTeaching(1)` for all of them.
   - `MU.stockUpTo(level)` — buys each material in "Stores and stock" (Week page) until its quantity reaches `level`.
   - `MU.assembleParty()` — with a commission selected in "Send a party" (Today page), greedily adds students (up to 7) and then escorts/professors (up to 4) until every requirement rating is at least "adequate," using the game's own live rating as feedback. It builds the team but does **not** click Send.
   - `MU.repairAll()` — repairs every building in "Capital projects" (Action page) whose repair cost is non-zero.
   - `MU.runActionPage()` — runs `hireScribes()`, `passAll()`, `tenureAll()`, and `repairAll()` back to back (Action page). A failure in one step is logged and doesn't stop the rest.
   - `MU.runTermPage()` — runs `graduateYear6()`, then clicks "Propose a schedule," then "Declare N by aptitude" (skipped if that button isn't showing), then "Open the week" (Term page). A failure in one step is logged and doesn't stop the rest.

The hire/tenure/stock/repair commands check your gold before each action
and automatically borrow from the Merchant Houses if you're short.
Passing is free, so `MU.passAll()` just runs through the list as fast as
the page's own exit animation allows.

None of the batch commands (`hireAll`/`hireScribes`/`tenureAll`/`passAll`/
`graduateYear6`/`stockUpTo`/`repairAll`) cap how many items they process —
each keeps going until nothing left matches its goal (empty list, cleared
cost, cleared tenure flag, etc). Between actions, each waits for that
specific effect to actually appear in the page (up to a few seconds)
instead of a fixed delay, and stops with a console warning if the page
never reflects a click rather than looping on a stuck row forever.

**Exception:** `MU.setAllRecruit()`/`MU.setResearch()`/`MU.setTeaching()`
send each standing-order change to the game's backend as a sequenced
command, with no client-visible signal for when the server has finished
processing one. Firing them with no gap races that sequencing and can
500 on the server side, so these three keep a small fixed pacing delay
(150ms) between changes rather than the goal-based waits used elsewhere.

**Note on `MU.assembleParty()`:** there's no per-student/professor stat
visible in the page for a mission requirement — only the party's overall
rating per requirement, shown as e.g. "hopeless" in red. The tool treats
anything *not* styled that red/warning color as "adequate or better,"
following this app's own color convention elsewhere. If that guess is
wrong for this page, let me know what an adequate-or-better rating
actually looks like and the threshold check can be corrected.

**Note on `MU.runTermPage()`:** proposing a schedule and declaring by
aptitude don't clear a row or flip a badge the way the other batch actions
do, so there's no precise "done" signal to poll for — the tool just waits
for *some* re-render in the relevant section after each click and moves on.
"Open the week" appears twice on the page (inline and in the bottom bar);
whichever copy is enabled gets clicked.
