// Magic University console tool: hiring and tenure.
//
// Usage:
//   1. Open the game in your browser, log in, and make sure you're on the
//      Action page (the one showing "On the market", "Faculty", "The
//      treasury", etc).
//   2. Open DevTools (F12) -> Console tab.
//   3. Paste this entire file and press Enter. You should see "[MU] Loaded.".
//   4. Run one of:
//        MU.status()       // reports gold, market composition, and faculty tenure status
//        MU.hireScribes()  // hires every Scribe candidate on the market
//        MU.hireAll()      // hires every candidate on the market
//        MU.tenureAll()    // tenures every hired professor who isn't tenured yet
//        MU.passAll()      // passes on every non-Scribe candidate on the market
//
// The hire/tenure commands borrow from the Merchant Houses automatically if
// gold on hand isn't enough to cover the next action's up-front cost. Passing
// costs nothing, so MU.passAll() just runs through the list as fast as the
// page's own exit animation allows — faster than the built-in "Pass over
// all" button. It skips Scribes so it doesn't undo MU.hireScribes().

(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function findSectionByHeading(headingText) {
    const heading = Array.from(document.querySelectorAll('h2')).find(
      (el) => el.textContent.trim().toLowerCase() === headingText.toLowerCase()
    );
    if (!heading) return null;
    return heading.closest('section');
  }

  function setNativeValue(input, value) {
    const proto = window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function parseNumber(str) {
    const match = String(str).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : NaN;
  }

  function getGold() {
    const label = Array.from(document.querySelectorAll('div')).find(
      (el) => el.children.length === 0 && el.textContent.trim().toLowerCase() === 'gold'
    );
    if (!label || !label.nextElementSibling) {
      throw new Error('Could not find the gold readout on this page.');
    }
    return parseNumber(label.nextElementSibling.textContent);
  }

  function getMarketRows() {
    const section = findSectionByHeading('On the market');
    if (!section) throw new Error('Could not find the "On the market" section on this page.');
    const rows = Array.from(section.querySelectorAll(':scope > div.p-4 > div'));
    return rows.filter((row) => row.querySelector('button'));
  }

  function rowName(row) {
    const el = row.querySelector('.min-w-0.flex-1 > div');
    if (!el) return '(unnamed)';
    // Strip badge spans (e.g. the "until year N" contract badge) so the name
    // doesn't come back glued to whatever text sits next to it.
    const clone = el.cloneNode(true);
    clone.querySelectorAll('span').forEach((s) => s.remove());
    return clone.textContent.trim() || '(unnamed)';
  }

  function rowIsScribe(row) {
    return !!row.querySelector('.text-scribe-400');
  }

  function rowHireCost(row) {
    const match = row.textContent.match(/([\d,]+)g to bring in/);
    return match ? parseNumber(match[1]) : 0;
  }

  function findButtonByText(container, text) {
    return Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent.trim().toLowerCase() === text.toLowerCase()
    );
  }

  async function borrowFromMerchantHouses(amount) {
    const section = findSectionByHeading('The treasury');
    if (!section) throw new Error('Could not find "The treasury" section to borrow from.');

    const label = Array.from(section.querySelectorAll('span')).find(
      (s) => s.textContent.trim() === 'The Merchant Houses'
    );
    if (!label) throw new Error('Could not find "The Merchant Houses" row.');

    const card = label.closest('div.rounded-md');
    const input = card.querySelector('input[type="number"]');
    const borrowBtn = findButtonByText(card, 'Borrow');
    if (!input || !borrowBtn) throw new Error('Could not find the Merchant Houses borrow controls.');
    if (borrowBtn.disabled) throw new Error('The Merchant Houses will not lend any more right now.');

    const capText = card.querySelector('p')?.textContent || '';
    const capMatch = capText.match(/lend ([\d,]+)g more/);
    const cap = capMatch ? parseNumber(capMatch[1]) : Infinity;

    const target = Math.min(amount, cap);
    if (target < amount) {
      console.warn(`[MU] Merchant Houses will only lend ${cap}g more; borrowing that instead of ${amount}g.`);
    }

    const step = Number(input.step) || 1;
    const rounded = Math.ceil(target / step) * step;

    setNativeValue(input, String(rounded));
    await wait(150);
    borrowBtn.click();
    await wait(400);
    console.log(`[MU] Borrowed ${rounded}g from the Merchant Houses.`);
  }

  async function ensureFunds(amount) {
    let gold = getGold();
    if (gold >= amount) return gold;
    await borrowFromMerchantHouses(amount - gold);
    gold = getGold();
    if (gold < amount) {
      throw new Error(`Still short of funds after borrowing: have ${gold}g, need ${amount}g.`);
    }
    return gold;
  }

  async function hireRow(row) {
    const hireBtn = findButtonByText(row, 'Hire');
    if (!hireBtn || hireBtn.disabled) return false;
    await ensureFunds(rowHireCost(row));
    hireBtn.click();
    await wait(500);
    return true;
  }

  async function hireMatching(predicate) {
    let hired = 0;
    for (let i = 0; i < 50; i++) {
      const row = getMarketRows().filter(predicate)[0];
      if (!row) break;
      const name = rowName(row);
      try {
        const ok = await hireRow(row);
        if (!ok) {
          console.warn(`[MU] Skipping ${name} — hire button unavailable.`);
          break;
        }
        console.log(`[MU] Hired ${name}.`);
        hired++;
      } catch (err) {
        console.warn(`[MU] Stopped before hiring ${name}: ${err.message}`);
        break;
      }
    }
    console.log(`[MU] Done. Hired ${hired} professor(s).`);
    return hired;
  }

  async function passRow(row) {
    const passBtn = findButtonByText(row, 'Pass');
    if (!passBtn || passBtn.disabled) return false;
    passBtn.click();
    // No funds check needed for a pass, so this can run much tighter than
    // the hire/tenure loops — just enough for the row's exit animation to
    // clear before the next query.
    await wait(200);
    return true;
  }

  async function passAll() {
    let passed = 0;
    for (let i = 0; i < 200; i++) {
      // Scribes are for hiring, not passing — leave them for MU.hireScribes().
      const row = getMarketRows().filter((r) => !rowIsScribe(r))[0];
      if (!row) break;
      const name = rowName(row);
      const ok = await passRow(row);
      if (!ok) {
        console.warn(`[MU] Skipping ${name} — pass button unavailable.`);
        break;
      }
      console.log(`[MU] Passed on ${name}.`);
      passed++;
    }
    console.log(`[MU] Done. Passed on ${passed} candidate(s).`);
    return passed;
  }

  function getFacultyRows() {
    const section = findSectionByHeading('Faculty');
    if (!section) throw new Error('Could not find the "Faculty" section on this page.');
    const rows = Array.from(section.querySelectorAll(':scope > div.p-4 > div'));
    return rows.filter((row) => row.querySelector('button'));
  }

  // The game disables/removes a professor's Tenure button once they're
  // tenured (tenure is permanent, per its own tooltip), so an enabled
  // Tenure button is what marks a row as still needing tenure.
  function rowNeedsTenure(row) {
    const btn = findButtonByText(row, 'Tenure');
    return !!btn && !btn.disabled;
  }

  function parseCostFromText(text) {
    const match = String(text || '').match(/([\d,]+)g/);
    return match ? parseNumber(match[1]) : 0;
  }

  function rowTenureCost(row) {
    const btn = findButtonByText(row, 'Tenure');
    if (!btn) return 0;
    return parseCostFromText(btn.textContent) || parseCostFromText(btn.title) || 0;
  }

  async function tenureRow(row) {
    const btn = findButtonByText(row, 'Tenure');
    if (!btn || btn.disabled) return false;
    await ensureFunds(rowTenureCost(row));
    btn.click();
    await wait(500);
    return true;
  }

  async function tenureAll() {
    let tenured = 0;
    for (let i = 0; i < 50; i++) {
      const row = getFacultyRows().filter(rowNeedsTenure)[0];
      if (!row) break;
      const name = rowName(row);
      try {
        const ok = await tenureRow(row);
        if (!ok) {
          console.warn(`[MU] Skipping ${name} — tenure button unavailable.`);
          break;
        }
        console.log(`[MU] Tenured ${name}.`);
        tenured++;
      } catch (err) {
        console.warn(`[MU] Stopped before tenuring ${name}: ${err.message}`);
        break;
      }
    }
    console.log(`[MU] Done. Tenured ${tenured} professor(s).`);
    return tenured;
  }

  const MU = window.MU || {};

  MU.status = () => {
    const gold = getGold();
    const marketRows = getMarketRows();
    const scribes = marketRows.filter(rowIsScribe);
    console.log(`[MU] Gold: ${gold}g`);
    console.log(`[MU] On the market: ${marketRows.length} candidate(s), ${scribes.length} Scribe(s).`);
    marketRows.forEach((row) => {
      console.log(`  ${rowIsScribe(row) ? '★' : ' '} ${rowName(row)} — ${rowHireCost(row)}g to bring in`);
    });

    let facultyRows = [];
    let untenured = [];
    try {
      facultyRows = getFacultyRows();
      untenured = facultyRows.filter(rowNeedsTenure);
      console.log(`[MU] Faculty: ${facultyRows.length} on the books, ${untenured.length} not yet tenured.`);
      untenured.forEach((row) => {
        console.log(`  ☐ ${rowName(row)} — tenure cost ${rowTenureCost(row)}g`);
      });
    } catch (err) {
      console.warn(`[MU] ${err.message}`);
    }

    return {
      gold,
      candidates: marketRows.length,
      scribes: scribes.length,
      faculty: facultyRows.length,
      untenured: untenured.length,
    };
  };

  MU.hireScribes = () => hireMatching(rowIsScribe);
  MU.hireAll = () => hireMatching(() => true);
  MU.tenureAll = () => tenureAll();
  MU.passAll = () => passAll();

  window.MU = MU;
  console.log('[MU] Loaded. Try MU.status(), MU.hireScribes(), MU.hireAll(), MU.tenureAll(), or MU.passAll().');
})();
