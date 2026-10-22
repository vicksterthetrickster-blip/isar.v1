// state.js — what the app is currently showing (changes while it runs).
// Loaded after storage.js. Holds the shared variables other files read and update.

let activeCurrency = BASE_CURRENCY;
let ratesAreLive = false;
let ratesAsOf = null;                 // the date the ECB published the rates we hold (YYYY-MM-DD)
let ratesUpdatedAt = null;            // when THIS page last fetched them (a Date, i.e. the refresh time)
let ratesLastFetchFailed = false;
let ratesRefreshing = false;

// --- Net worth history graph ---
// HISTORY is loaded from historynetworth.js. Each record holds native account
// balances plus that date's FX rates. Net worth is calculated per record using
// THAT record's own rates, so switching currency re-values every past point
// correctly instead of just rescaling today's numbers.
const TIMEFRAMES = { '3 Months': 3, '6 Months': 6, '1 Year': 12, '2 Years': 24, 'All Time': null };
let activeTimeframe = '6 Months';
let openAccountId = null;                 // account whose detail screen is open
let accountTimeframe = '6 Months';        // window for the account detail graph
let acctViewCurrency = null;                // this account's own display currency; local only, never saved
let performanceOpen = false;               // whether the Performance screen is open
let perfScrubActive = false;                // whether the user is currently dragging the graph
let perfLayout = null;                      // last drawGraph() result for the big graph (for scrub math)
const ACCOUNT_TIMEFRAMES = [['3M', '3 Months'], ['6M', '6 Months'], ['1Y', '1 Year'], ['All', 'All Time']];
const PERF_TIMEFRAMES = [['3M', '3 Months'], ['6M', '6 Months'], ['1Y', '1 Year'], ['2Y', '2 Years'], ['All', 'All Time']];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
