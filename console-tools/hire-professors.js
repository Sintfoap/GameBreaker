// Magic University console tool: hiring, tenure, graduation, standing
// orders, stock purchasing, and mission parties.
//
// Usage:
//   1. Open the game in your browser, log in, and make sure you're on the
//      page that has the section you want to act on (the Action page for
//      "On the market"/"Faculty"/"The treasury"; the Term page for
//      "Students"; the Today page for "Standing orders" and "Send a
//      party" under "The Chancellor's time"/Commissions; the Week page
//      for "Stores and stock").
//   2. Open DevTools (F12) -> Console tab.
//   3. Paste this entire file and press Enter. You should see "[MU] Loaded.".
//   4. Run one of:
//        MU.status()          // reports gold, market composition, and faculty tenure status
//        MU.hireScribes()     // hires every Scribe candidate on the market
//        MU.hireAll()         // hires every candidate on the market
//        MU.tenureAll()       // tenures every hired professor who isn't tenured yet
//        MU.passAll()         // passes on every remaining candidate on the market
//        MU.graduateYear6()   // graduates every student tagged "yr 6" in the Students list
//        MU.setAllRecruit()   // sets every professor's standing order to "recruit"
//        MU.setResearch(f)    // sets a fraction f (0-1) of professors to "research"; MU.setResearch(1) for all
//        MU.setTeaching(f)    // sets a fraction f (0-1) of non-researching professors to "teach"
//        MU.stockUpTo(level)  // buys each material in "Stores and stock" until its quantity reaches level
//        MU.assembleParty()   // builds a party (up to 7 students, up to 4 escorts) for the selected commission
//        MU.repairAll()       // repairs every building in "Capital projects" with a non-zero repair cost
//
// The hire/tenure/stock/repair commands borrow from the Merchant Houses
// automatically if gold on hand isn't enough to cover the next action's
// up-front cost. Passing costs nothing, so MU.passAll() just runs through
// the list as fast as the page's own exit animation allows — faster than
// the built-in "Pass over all" button. MU.assembleParty() builds the team
// but does not click Send — you review and dispatch it yourself.
//
// None of the batch commands (hireAll/hireScribes/tenureAll/passAll/
// graduateYear6/stockUpTo/repairAll) cap how many items they'll process --
// each just keeps going until nothing left matches its goal (an empty
// list, a cleared cost, a cleared tenure flag, etc). Between actions, each
// one waits for that specific effect to actually show up in the DOM
// (up to a few seconds) rather than a fixed delay, and gives up with a
// console warning if the page never reflects the click, instead of
// looping on a stuck row forever.

(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Polls fn() instead of waiting a fixed delay, since re-renders after a
  // click don't always land within a fixed window under load -- returns as
  // soon as fn() is true, or false if it never becomes true within timeout.
  async function waitForCondition(fn, { timeout = 3000, interval = 50 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (fn()) return true;
      await wait(interval);
    }
    return fn();
  }

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

  // React tracks <select> changes off the native "change" event (not
  // "input"), so this needs its own setter mirroring setNativeValue above.
  function setNativeSelectValue(select, value) {
    const proto = window.HTMLSelectElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
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

    const goldBefore = getGold();
    setNativeValue(input, String(rounded));
    await waitForCondition(() => input.value === String(rounded), { timeout: 500, interval: 20 });
    borrowBtn.click();
    const borrowed = await waitForCondition(() => getGold() > goldBefore, { timeout: 3000, interval: 50 });
    if (!borrowed) {
      throw new Error('Borrowing did not appear to add gold; the page may be slow to update.');
    }
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
    if (!hireBtn || hireBtn.disabled) return 'unavailable';
    await ensureFunds(rowHireCost(row));
    hireBtn.click();
    const cleared = await waitForCondition(() => !getMarketRows().includes(row), { timeout: 3000, interval: 50 });
    return cleared ? 'ok' : 'stuck';
  }

  // No item cap: keeps going until no candidate matches the predicate
  // anymore, rather than stopping after an arbitrary count. A row that
  // doesn't clear after a click ("stuck") ends the run instead of looping
  // on it forever.
  async function hireMatching(predicate) {
    let hired = 0;
    while (true) {
      const row = getMarketRows().filter(predicate)[0];
      if (!row) break;
      const name = rowName(row);
      try {
        const result = await hireRow(row);
        if (result === 'unavailable') {
          console.warn(`[MU] Skipping ${name} — hire button unavailable.`);
          break;
        }
        if (result === 'stuck') {
          console.warn(`[MU] Stopped — ${name} didn't leave the market after hiring; the page may be slow to update.`);
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
    // A button can read disabled for a moment mid re-render, not just when
    // truly unavailable -- give it a short grace period before giving up.
    const ready = await waitForCondition(() => {
      const btn = findButtonByText(row, 'Pass');
      return !!btn && !btn.disabled;
    }, { timeout: 500, interval: 50 });
    if (!ready) return 'unavailable';

    findButtonByText(row, 'Pass').click();

    // No funds check needed for a pass, so this can run much tighter than
    // the hire/tenure loops -- but instead of guessing a fixed delay for
    // the exit animation (which caused false "done" reads when a re-render
    // ran long), wait until this exact row actually leaves the market list.
    const cleared = await waitForCondition(() => !getMarketRows().includes(row), { timeout: 3000, interval: 50 });
    return cleared ? 'ok' : 'stuck';
  }

  // No item cap: keeps passing until the market list is actually empty.
  async function passAll() {
    let passed = 0;
    while (true) {
      const row = getMarketRows()[0];
      if (!row) break;
      const name = rowName(row);
      const result = await passRow(row);
      if (result === 'unavailable') {
        console.warn(`[MU] Skipping ${name} — pass button unavailable.`);
        break;
      }
      if (result === 'stuck') {
        console.warn(`[MU] Stopped — ${name} didn't leave the market after passing; the page may be slow to update.`);
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
  // The Tenure button's disabled state lags behind the real game state
  // when there are many faculty rows and re-renders are slow, so tenure
  // status is read from the badge next to the professor's name instead:
  // "until year N" (still on a term contract) vs "tenured" (permanent,
  // per its own tooltip). Falls back to the button if no badge is found.
  function facultyBadgeText(row) {
    const nameEl = row.querySelector('.min-w-0.flex-1 > div');
    const badge = nameEl ? nameEl.querySelector('span') : null;
    return badge ? badge.textContent.trim() : '';
  }

  function rowNeedsTenure(row) {
    const badge = facultyBadgeText(row);
    if (/tenured/i.test(badge)) return false;
    if (/until year/i.test(badge)) return true;
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
    // Re-look-up by name on every poll rather than trusting the held
    // node: if the Faculty list re-renders wholesale under load, the
    // original row node can end up detached and frozen, which would
    // otherwise make every check below see stale content forever.
    const name = rowName(row);
    const findFresh = () => getFacultyRows().find((r) => rowName(r) === name);

    const ready = await waitForCondition(() => {
      const r = findFresh();
      const btn = r && findButtonByText(r, 'Tenure');
      return !!btn && !btn.disabled;
    }, { timeout: 5000, interval: 100 });
    if (!ready) return 'unavailable';

    const beforeFunds = findFresh();
    if (!beforeFunds) return 'unavailable';
    await ensureFunds(rowTenureCost(beforeFunds));

    const freshRow = findFresh();
    const btn = freshRow && findButtonByText(freshRow, 'Tenure');
    if (!btn || btn.disabled) return 'unavailable';
    btn.click();

    // Tenure doesn't remove the row (the professor stays in Faculty) --
    // the goal here is the badge switching from "until year N" to
    // "tenured", checked on a freshly looked-up row each poll.
    const cleared = await waitForCondition(() => {
      const r = findFresh();
      return !!r && !rowNeedsTenure(r);
    }, { timeout: 5000, interval: 100 });
    return cleared ? 'ok' : 'stuck';
  }

  // No item cap: keeps going until no faculty row still needs tenure.
  async function tenureAll() {
    let tenured = 0;
    // A professor whose Tenure button won't cooperate (or whose badge
    // won't update) is skipped, not treated as a reason to stop -- only a
    // funds error (a global constraint that will recur for everyone else
    // too) ends the run early.
    const skipped = new Set();
    while (true) {
      const row = getFacultyRows().filter((r) => rowNeedsTenure(r) && !skipped.has(rowName(r)))[0];
      if (!row) break;
      const name = rowName(row);
      try {
        const result = await tenureRow(row);
        if (result === 'unavailable') {
          console.warn(`[MU] Skipping ${name} — tenure button unavailable.`);
          skipped.add(name);
          continue;
        }
        if (result === 'stuck') {
          console.warn(`[MU] Skipping ${name} — tenure status didn't update; the page may be slow to update.`);
          skipped.add(name);
          continue;
        }
        console.log(`[MU] Tenured ${name}.`);
        tenured++;
      } catch (err) {
        console.warn(`[MU] Stopped before tenuring ${name}: ${err.message}`);
        break;
      }
    }
    if (skipped.size > 0) {
      console.warn(`[MU] Skipped ${skipped.size} professor(s): ${Array.from(skipped).join(', ')}.`);
    }
    console.log(`[MU] Done. Tenured ${tenured} professor(s).`);
    return tenured;
  }

  function findButtonStartingWith(container, text) {
    const lower = text.toLowerCase();
    return Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.trim().toLowerCase().startsWith(lower)
    );
  }

  function getStudentRows() {
    const section = findSectionByHeading('Students');
    if (!section) throw new Error('Could not find the "Students" section on this page.');
    return Array.from(section.querySelectorAll(':scope div.flex.items-center.gap-2.px-2.py-1.text-xs'));
  }

  function studentName(row) {
    const btn = row.querySelector('button.truncate');
    return btn ? btn.textContent.trim() : '(unnamed student)';
  }

  function studentYear(row) {
    const span = Array.from(row.querySelectorAll(':scope > span')).find((s) =>
      /^yr\s*\d+$/i.test(s.textContent.trim())
    );
    if (!span) return null;
    const match = span.textContent.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  // Graduating a student away on a commission shows a toast instead of
  // actually removing the row -- without checking for it, the loop below
  // would just keep re-selecting that same student forever.
  function isAwayOnCommissionToastShown() {
    const toast = document.querySelector('button.fixed.bottom-16');
    return !!toast && /away on a commission/i.test(toast.textContent);
  }

  async function graduateRow(row) {
    const btn = findButtonStartingWith(row, 'Graduate');
    if (!btn || btn.disabled) return 'unavailable';
    btn.click();
    const settled = await waitForCondition(
      () => isAwayOnCommissionToastShown() || !getStudentRows().includes(row),
      { timeout: 3000, interval: 50 }
    );
    if (!settled) return 'stuck';
    if (isAwayOnCommissionToastShown()) return 'blocked';
    return 'ok';
  }

  // No item cap: keeps going until no yr-N student remains (skipping, not
  // retrying, students blocked by a commission).
  async function graduateYear(targetYear) {
    let graduated = 0;
    const skipped = new Set();
    while (true) {
      const row = getStudentRows().find((r) => studentYear(r) === targetYear && !skipped.has(studentName(r)));
      if (!row) break;
      const name = studentName(row);
      const result = await graduateRow(row);
      if (result === 'blocked') {
        console.warn(`[MU] Skipping ${name} — away on a commission.`);
        skipped.add(name);
        continue;
      }
      if (result === 'unavailable') {
        console.warn(`[MU] Skipping ${name} — graduate button unavailable.`);
        break;
      }
      if (result === 'stuck') {
        console.warn(`[MU] Stopped — ${name} didn't graduate or show a reason why; the page may be slow to update.`);
        break;
      }
      console.log(`[MU] Graduated ${name} (yr ${targetYear}).`);
      graduated++;
    }
    console.log(`[MU] Done. Graduated ${graduated} student(s) at yr ${targetYear}.`);
    return graduated;
  }

  function getStandingOrderRows() {
    const label = Array.from(document.querySelectorAll('div')).find(
      (el) => el.children.length === 0 && el.textContent.trim() === 'Standing orders'
    );
    if (!label) throw new Error('Could not find the "Standing orders" section on this page.');
    return Array.from(label.parentElement.querySelectorAll(':scope > div')).filter((row) =>
      row.querySelector('select')
    );
  }

  function standingOrderName(row) {
    return row.querySelector('span')?.textContent?.trim() || '(unnamed)';
  }

  function setStandingOrder(row, value) {
    const select = row.querySelector('select');
    if (!select || select.value === value) return false;
    setNativeSelectValue(select, value);
    return true;
  }

  // Standing-order changes aren't purely local state: each one is sent to
  // the game's backend as a sequenced command (command_log). Firing them
  // back-to-back with no gap races that sequence counter and can 500 the
  // insert server-side, so unlike the DOM-driven batch actions above,
  // there's no client-visible "done" signal to poll for here -- a fixed
  // pacing delay between commands is the correct fix, not a workaround.
  const STANDING_ORDER_PACING_MS = 150;

  async function setAllRecruit() {
    const rows = getStandingOrderRows();
    let changed = 0;
    for (const row of rows) {
      if (setStandingOrder(row, 'recruit')) {
        console.log(`[MU] Set ${standingOrderName(row)} to recruit.`);
        changed++;
        await wait(STANDING_ORDER_PACING_MS);
      }
    }
    console.log(`[MU] Done. Set ${changed} of ${rows.length} standing order(s) to recruit.`);
    return changed;
  }

  // fraction is 0-1 (e.g. 0.1 for a tenth, 1 for everyone). At least one
  // professor is set as long as the fraction is above 0 and someone exists,
  // rather than rounding a small faculty down to zero.
  async function setOrderForFraction(rows, fraction, value, label) {
    if (rows.length === 0) {
      console.warn(`[MU] No eligible standing orders found for "${label}".`);
      return 0;
    }
    const clamped = Math.max(0, Math.min(1, fraction));
    const count = clamped >= 1 ? rows.length : Math.max(1, Math.round(rows.length * clamped));
    let changed = 0;
    for (const row of rows.slice(0, count)) {
      if (setStandingOrder(row, value)) {
        console.log(`[MU] Set ${standingOrderName(row)} to ${value}.`);
        changed++;
        await wait(STANDING_ORDER_PACING_MS);
      }
    }
    console.log(`[MU] Done. Set ${changed} of ${rows.length} standing order(s) to ${value}.`);
    return changed;
  }

  async function setResearch(fraction) {
    return setOrderForFraction(getStandingOrderRows(), fraction, 'research', 'research');
  }

  async function setTeaching(fraction) {
    const rows = getStandingOrderRows().filter((row) => row.querySelector('select')?.value !== 'research');
    return setOrderForFraction(rows, fraction, 'teach', 'non-researching -> teach');
  }

  function getMaterialRows() {
    const section = findSectionByHeading('Stores and stock');
    if (!section) throw new Error('Could not find the "Stores and stock" section on this page.');
    const label = Array.from(section.querySelectorAll('div')).find(
      (el) => el.children.length === 0 && el.textContent.trim() === 'Materials'
    );
    if (!label || !label.nextElementSibling) {
      throw new Error('Could not find the "Materials" list in "Stores and stock".');
    }
    return Array.from(label.nextElementSibling.querySelectorAll(':scope > div'));
  }

  function materialName(row) {
    return row.querySelector('span.capitalize')?.textContent?.trim() || '(unknown material)';
  }

  function materialAmount(row) {
    return parseNumber(row.querySelector('span.tabular')?.textContent);
  }

  // Buy buttons read like "+40 · 240g" — a fixed quantity added for a fixed
  // cost, not a per-unit price, so both need parsing off the button itself.
  function materialBuyInfo(row) {
    const btn = row.querySelector('button');
    if (!btn) return null;
    const match = btn.textContent.match(/\+([\d,]+)\D+([\d,]+)g/);
    if (!match) return null;
    return { button: btn, quantity: parseNumber(match[1]), cost: parseNumber(match[2]) };
  }

  async function buyMaterialRow(row, name) {
    const buy = materialBuyInfo(row);
    if (!buy || buy.button.disabled) return 'unavailable';
    await ensureFunds(buy.cost);
    const before = materialAmount(row);
    buy.button.click();
    console.log(`[MU] Bought +${buy.quantity} ${name} for ${buy.cost}g.`);
    const changed = await waitForCondition(() => {
      const current = getMaterialRows().find((r) => materialName(r) === name);
      return !!current && materialAmount(current) > before;
    }, { timeout: 3000, interval: 50 });
    return changed ? 'ok' : 'stuck';
  }

  // No purchase-count cap per material: keeps buying until its quantity
  // reaches the target, rather than stopping after an arbitrary number of
  // purchases.
  async function stockUpTo(target) {
    const names = getMaterialRows().map(materialName);
    let purchases = 0;
    for (const name of names) {
      while (true) {
        const row = getMaterialRows().find((r) => materialName(r) === name);
        if (!row) break;
        if (materialAmount(row) >= target) break;
        try {
          const result = await buyMaterialRow(row, name);
          if (result === 'unavailable') {
            console.warn(`[MU] Stopped buying ${name} — buy button unavailable.`);
            break;
          }
          if (result === 'stuck') {
            console.warn(`[MU] Stopped buying ${name} — quantity didn't increase after purchase; the page may be slow to update.`);
            break;
          }
          purchases++;
        } catch (err) {
          console.warn(`[MU] Stopped buying ${name}: ${err.message}`);
          break;
        }
      }
    }
    console.log(`[MU] Done. Made ${purchases} purchase(s) toward a target of ${target}.`);
    return purchases;
  }

  // "Send a party": builds a mission party using the game's own live
  // feedback as the source of truth, since individual student/professor
  // capability isn't exposed anywhere in the DOM — only the party's
  // aggregate rating per requirement, which updates as members are
  // toggled in and out. This treats any rating NOT styled as the "bad"
  // red (text-ruin-400) or caution (text-warn-400) color as "at least
  // adequate" — following this app's own color convention elsewhere
  // (red = shortfall, neutral/green = fine). Adjust ratingMeetsThreshold
  // if that guess turns out wrong.
  async function assembleParty({ maxStudents = 7, maxEscorts = 4 } = {}) {
    const section = findSectionByHeading('Send a party');
    if (!section) throw new Error('Could not find the "Send a party" section on this page.');
    if (/no commission selected/i.test(section.textContent)) {
      throw new Error('No commission is selected — click one in the Commissions list first.');
    }

    function getCandidateButtons() {
      const container = section.querySelector('div.max-h-56');
      if (!container) throw new Error('Could not find the party candidate list.');
      return Array.from(container.querySelectorAll(':scope > button'));
    }

    function getEscortButtons() {
      const label = Array.from(section.querySelectorAll('div')).find(
        (el) => el.children.length === 0 && el.textContent.trim() === 'Escort'
      );
      if (!label || !label.nextElementSibling) return [];
      return Array.from(label.nextElementSibling.querySelectorAll('button'));
    }

    function getRequirementRows() {
      const marker = Array.from(section.querySelectorAll('p')).find(
        (p) => p.textContent.trim() === 'What they can answer'
      );
      return marker ? Array.from(marker.parentElement.querySelectorAll(':scope > div')) : [];
    }

    function ratingMeetsThreshold(row) {
      const rating = row.querySelector('span:last-child');
      if (!rating) return true;
      return !rating.classList.contains('text-ruin-400') && !rating.classList.contains('text-warn-400');
    }

    function allRequirementsMet() {
      const rows = getRequirementRows();
      return rows.length > 0 && rows.every(ratingMeetsThreshold);
    }

    function candidateName(btn) {
      return btn.querySelector('.truncate')?.textContent?.trim() || btn.textContent.trim();
    }

    // There's no clean boolean condition for "did adding this candidate
    // help" beyond re-reading the ratings, so this waits for the panel to
    // actually re-render (a DOM mutation) instead of guessing a fixed
    // delay -- returns as soon as something changes, or after timeout if
    // the click genuinely had no visible effect.
    function waitForPartyUpdate(timeout = 1000) {
      return new Promise((resolve) => {
        let settled = false;
        const observer = new MutationObserver(() => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          resolve();
        });
        observer.observe(section, { childList: true, subtree: true, characterData: true, attributes: true });
        setTimeout(() => {
          if (settled) return;
          settled = true;
          observer.disconnect();
          resolve();
        }, timeout);
      });
    }

    async function tryAdd(getButtons, chosen, rejected, cap, label) {
      if (chosen.length >= cap) return false;
      const candidates = getButtons().filter(
        (b) => !chosen.includes(candidateName(b)) && !rejected.has(candidateName(b))
      );
      for (const btn of candidates) {
        const name = candidateName(btn);
        const before = getRequirementRows().map(ratingMeetsThreshold);
        btn.click();
        await waitForPartyUpdate();
        const after = getRequirementRows().map(ratingMeetsThreshold);
        const helped = after.some((ok, i) => ok && !before[i]);
        if (helped) {
          chosen.push(name);
          console.log(`[MU] Added ${name} to the party (${label}).`);
          return true;
        }
        btn.click();
        await waitForPartyUpdate();
        rejected.add(name);
      }
      return false;
    }

    const students = [];
    const escorts = [];
    const rejectedStudents = new Set();
    const rejectedEscorts = new Set();

    if (allRequirementsMet()) {
      console.log('[MU] Requirements are already met with the current party.');
      return { students, escorts };
    }

    let progressed = true;
    while (progressed && !allRequirementsMet()) {
      progressed = await tryAdd(getCandidateButtons, students, rejectedStudents, maxStudents, 'student');
      if (!progressed) {
        progressed = await tryAdd(getEscortButtons, escorts, rejectedEscorts, maxEscorts, 'escort');
      }
    }

    if (allRequirementsMet()) {
      console.log(`[MU] Done. Party meets every requirement: ${students.length} student(s), ${escorts.length} escort(s).`);
    } else {
      console.warn(
        `[MU] Stopped short: ${students.length} student(s) and ${escorts.length} escort(s) selected, but some requirements are still below adequate (caps reached or no candidate helps further).`
      );
    }
    return { students, escorts };
  }

  function getBuildingRows() {
    const section = findSectionByHeading('Capital projects');
    if (!section) throw new Error('Could not find the "Capital projects" section on this page.');
    return Array.from(section.querySelectorAll(':scope > div.p-4 > div.space-y-1 > div'));
  }

  function buildingName(row) {
    const el = row.querySelector('span.truncate');
    if (!el) return '(unnamed building)';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('span').forEach((s) => s.remove());
    return clone.textContent.trim() || '(unnamed building)';
  }

  function buildingRepairButton(row) {
    return findButtonStartingWith(row, 'Repair');
  }

  function buildingRepairCost(row) {
    const btn = buildingRepairButton(row);
    return btn ? parseCostFromText(btn.textContent) : 0;
  }

  async function repairRow(row, name) {
    const btn = buildingRepairButton(row);
    if (!btn || btn.disabled) return 'unavailable';
    const cost = buildingRepairCost(row);
    if (cost <= 0) return 'unavailable';
    await ensureFunds(cost);
    btn.click();
    console.log(`[MU] Repaired ${name} for ${cost}g.`);
    const cleared = await waitForCondition(() => buildingRepairCost(row) <= 0, { timeout: 3000, interval: 50 });
    return cleared ? 'ok' : 'stuck';
  }

  // No item cap: keeps going until no building has a non-zero repair cost.
  async function repairAll() {
    let repaired = 0;
    while (true) {
      const row = getBuildingRows().find((r) => {
        const btn = buildingRepairButton(r);
        return btn && !btn.disabled && buildingRepairCost(r) > 0;
      });
      if (!row) break;
      const name = buildingName(row);
      try {
        const result = await repairRow(row, name);
        if (result === 'unavailable') {
          console.warn(`[MU] Skipping ${name} — repair button unavailable.`);
          break;
        }
        if (result === 'stuck') {
          console.warn(`[MU] Stopped — ${name}'s repair cost didn't clear; the page may be slow to update.`);
          break;
        }
        repaired++;
      } catch (err) {
        console.warn(`[MU] Stopped before repairing ${name}: ${err.message}`);
        break;
      }
    }
    console.log(`[MU] Done. Repaired ${repaired} building(s).`);
    return repaired;
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
  MU.graduateYear6 = () => graduateYear(6);
  MU.setAllRecruit = () => setAllRecruit();
  MU.setResearch = (fraction = 1) => setResearch(fraction);
  MU.setTeaching = (fraction = 1) => setTeaching(fraction);
  MU.stockUpTo = (target) => stockUpTo(target);
  MU.assembleParty = (opts) => assembleParty(opts || {});
  MU.repairAll = () => repairAll();

  window.MU = MU;
  console.log(
    '[MU] Loaded. Try MU.status(), MU.hireScribes(), MU.hireAll(), MU.tenureAll(), MU.passAll(), MU.graduateYear6(), MU.setAllRecruit(), MU.setResearch(fraction), MU.setTeaching(fraction), MU.stockUpTo(level), MU.assembleParty(), or MU.repairAll().'
  );
})();
