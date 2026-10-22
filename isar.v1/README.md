# Isar

A personal finance app prototype: global net worth across banks and currencies.

## Running it

Open this folder in VS Code and start **Live Server** on `index.html`
(or open `index.html` directly in a browser).

`historynetworth.js` (your net-worth history data) goes in this folder, next to `index.html`.

## Where things live

| File | What it does |
|---|---|
| `index.html` | Page structure only: screens, tabs, buttons |
| `css/styles.css` | All styling |
| `js/data.js` | Fixed data: bank list, user, accounts, currencies |
| `js/storage.js` | Saving/loading what the user changes (localStorage) |
| `js/state.js` | What the app is currently showing (selected currency, timeframe, open screens) |
| `js/history.js` | Turns history records into graph data |
| `js/graph.js` | Draws the line graphs |
| `js/rates.js` | Currency conversion, live exchange rates, net worth card |
| `js/accounts.js` | Accounts tab and account detail screen |
| `js/cards.js` | Cards tab |
| `js/connect.js` | Connect tab: bank search and linking |
| `js/profile.js` | Profile, settings, sign out |
| `js/performance.js` | Performance screen |
| `js/main.js` | Tab switching and start-up |
| 'js/historynetworth.js' | Made-up History data for networth |


## Rules to keep it working

- **Script order matters.** The `<script>` tags at the bottom of `index.html` load in order.
  `data.js` → `storage.js` → `state.js` come first, and `main.js` must stay last.
  New files go anywhere between `state.js` and `main.js`.
- **Code that runs on load goes in `main.js`.** Other files should only *define*
  functions and variables, so they never call something that isn't loaded yet.
- **To remember something between sessions:** add it to the object in
  `loadSavedData()` (`storage.js`), set `SAVED.yourThing = ...`, then call `saveData()`.
- **Clear saved data:** the link at the bottom of the Connect tab.
