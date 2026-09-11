# GameBreaker

Browser-console tools for automating repetitive actions in *Magic University*
(https://hooks.rhysfuller.com/), a client-side React game. Since the game
runs entirely in your browser and this environment can't reach the site over
the network, these tools are plain JavaScript you paste into the browser's
DevTools console — they act on the page using your own logged-in session.

## Tools

### `console-tools/hire-professors.js`

Automates the "On the market" hiring section on the Action page.

**Usage:**
1. Open the game, log in, and go to the Action page.
2. Open DevTools (F12) → Console tab.
3. Paste the entire contents of `console-tools/hire-professors.js` and press Enter.
4. Run one of:
   - `MU.status()` — reports current gold and lists market candidates, flagging Scribes.
   - `MU.hireScribes()` — hires every candidate on the market with the Scribe attribute.
   - `MU.hireAll()` — hires every candidate on the market.

Both hiring commands check your gold before each hire and automatically
borrow from the Merchant Houses if you're short.
