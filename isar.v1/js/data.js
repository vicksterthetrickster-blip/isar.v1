// data.js — fixed app data: bank list, user, accounts, currencies.
// Loaded first. Other files read these values; nothing here touches the page.

// Every institution you can link: the top 40 global banks, then fintechs, brokers and crypto
// exchanges. `domain` is the website, used to fetch the logo (logos.js). `kind` (when not a
// bank) lets a search for a category word find it, e.g. "crypto" finds every exchange.
// `monogram` replaces the logo where logo.dev has none of its own (CommSec only has CommBank's).
const topBanks = [
    { name: "JPMorgan Chase", code: "JPM", color: "#1D4ED8", domain: "chase.com" },
    { name: "Bank of America", code: "BAC", color: "#DC2626", domain: "bankofamerica.com" },
    { name: "Industrial and Commercial Bank of China", code: "ICBC", color: "#B91C1C", domain: "icbc.com.cn" },
    { name: "China Construction Bank", code: "CCB", color: "#0369A1", domain: "ccb.com" },
    { name: "Agricultural Bank of China", code: "ABC", color: "#047857", domain: "abchina.com" },
    { name: "HSBC Holdings", code: "HSBC", color: "#E11D48", domain: "hsbc.com" },
    { name: "Citigroup", code: "CITI", color: "#0284C7", domain: "citi.com" },
    { name: "Bank of China", code: "BOC", color: "#C53030", domain: "boc.cn" },
    { name: "Mitsubishi UFJ Financial Group", code: "MUFG", color: "#D97706", domain: "mufg.jp" },
    { name: "Wells Fargo", code: "WFC", color: "#B45309", domain: "wellsfargo.com" },
    { name: "BNP Paribas", code: "BNP", color: "#0EA5E9", domain: "bnpparibas.com" },
    { name: "Goldman Sachs", code: "GS", color: "#475569", domain: "goldmansachs.com" },
    { name: "Morgan Stanley", code: "MS", color: "#334155", domain: "morganstanley.com" },
    { name: "UBS Group", code: "UBS", color: "#C2410C", domain: "ubs.com" },
    { name: "Banco Santander", code: "SAN", color: "#EF4444", domain: "santander.com" },
    { name: "State Street Corporation", code: "STT", color: "#0F766E", domain: "statestreet.com" },
    { name: "Toronto-Dominion Bank", code: "TD", color: "#15803D", domain: "td.com" },
    { name: "BBVA", code: "BBVA", color: "#004481", domain: "bbva.com" },
    { name: "Intesa Sanpaolo", code: "ISP", color: "#1D4ED8", domain: "intesasanpaolo.com" },
    { name: "Scotiabank", code: "BNS", color: "#B91C1C", domain: "scotiabank.com" },
    { name: "Commonwealth Bank", code: "CBA", color: "#FACC15", domain: "commbank.com.au" },
    { name: "Westpac", code: "WBC", color: "#DA1710", domain: "westpac.com.au" },
    { name: "ANZ Bank", code: "ANZ", color: "#008559", domain: "anz.com" },
    { name: "National Australia Bank", code: "NAB", color: "#DC2626", domain: "nab.com.au" },
    { name: "Credit Agricole", code: "ACA", color: "#1E3A8A", domain: "credit-agricole.com" },
    { name: "Societe Generale", code: "GLE", color: "#C2410C", domain: "societegenerale.com" },
    { name: "Standard Chartered", code: "STAN", color: "#0284C7", domain: "sc.com" },
    { name: "Nomura Holdings", code: "NMR", color: "#B45309", domain: "nomura.com" },
    { name: "BNY Mellon", code: "BK", color: "#475569", domain: "bny.com" },
    { name: "PNC Financial Services", code: "PNC", color: "#1E40AF", domain: "pnc.com" },
    { name: "Truist Financial", code: "TFC", color: "#7E22CE", domain: "truist.com" },
    { name: "Quebec National Bank", code: "NB", color: "#047857", domain: "nbc.ca" },
    { name: "Nordea", code: "NDA", color: "#003755", domain: "nordea.com" },
    { name: "Rabobank", code: "RABO", color: "#FF6600", domain: "rabobank.com" },
    { name: "Commerzbank", code: "CBK", color: "#F59E0B", domain: "commerzbank.com" },
    { name: "Deutsche Bank", code: "DB", color: "#001A6E", domain: "db.com" },
    { name: "Barclays", code: "BARC", color: "#00AEEF", domain: "barclays.com" },
    { name: "NatWest Group", code: "NWG", color: "#581C87", domain: "natwest.com" },
    { name: "Lloyds Banking Group", code: "LLOY", color: "#006A4E", domain: "lloydsbank.com" },
    { name: "Monzo", code: "M", color: "#FF5964", domain: "monzo.com" },

    // Fintechs and digital banks
    { name: "Revolut", code: "REV", color: "#191C1F", domain: "revolut.com", kind: "fintech" },
    { name: "Wise", code: "WISE", color: "#163300", domain: "wise.com", kind: "fintech" },
    { name: "N26", code: "N26", color: "#36A18B", domain: "n26.com", kind: "fintech" },
    { name: "Starling Bank", code: "STRL", color: "#6935D3", domain: "starlingbank.com", kind: "fintech" },
    { name: "Up", code: "UP", color: "#FF7A64", domain: "up.com.au", kind: "fintech" },
    { name: "ING", code: "ING", color: "#FF6200", domain: "ing.com", kind: "fintech" },
    { name: "Macquarie Bank", code: "MQG", color: "#1A1A1A", domain: "macquarie.com.au", kind: "fintech" },
    { name: "Chime", code: "CHM", color: "#1EC677", domain: "chime.com", kind: "fintech" },
    { name: "PayPal", code: "PYPL", color: "#003087", domain: "paypal.com", kind: "fintech" },

    // Brokers and investing apps
    { name: "Interactive Brokers", code: "IBKR", color: "#D71920", domain: "interactivebrokers.com", kind: "broker" },
    { name: "Charles Schwab", code: "SCHW", color: "#00A0DF", domain: "schwab.com", kind: "broker" },
    { name: "Fidelity", code: "FID", color: "#368727", domain: "fidelity.com", kind: "broker" },
    { name: "Vanguard", code: "VG", color: "#96151D", domain: "vanguard.com", kind: "broker" },
    { name: "Robinhood", code: "HOOD", color: "#CCFF00", domain: "robinhood.com", kind: "broker" },
    { name: "eToro", code: "ETOR", color: "#13C636", domain: "etoro.com", kind: "broker" },
    { name: "Trading 212", code: "T212", color: "#1A73E8", domain: "trading212.com", kind: "broker" },
    { name: "CommSec", code: "CSEC", color: "#111111", monogram: "CS", kind: "broker" },
    { name: "Stake", code: "STK", color: "#111111", domain: "hellostake.com", kind: "broker" },
    { name: "Hargreaves Lansdown", code: "HL", color: "#0A2240", domain: "hl.co.uk", kind: "broker" },

    // Crypto exchanges
    { name: "Crypto.com", code: "CRO", color: "#002D74", domain: "crypto.com", kind: "crypto" },
    { name: "Coinbase", code: "COIN", color: "#0052FF", domain: "coinbase.com", kind: "crypto" },
    { name: "Binance", code: "BNB", color: "#F0B90B", domain: "binance.com", kind: "crypto" },
    { name: "Kraken", code: "KRKN", color: "#5741D9", domain: "kraken.com", kind: "crypto" },
    { name: "Gemini", code: "GEMI", color: "#00B4D8", domain: "gemini.com", kind: "crypto" },
    { name: "OKX", code: "OKX", color: "#111111", domain: "okx.com", kind: "crypto" },
    { name: "Swyftx", code: "SWYF", color: "#0072F5", domain: "swyftx.com", kind: "crypto" }
];

// Words that find a whole category in search: typing the start of any of these
// (e.g. "cry", "broker", "stocks") lists every institution of that kind.
const KIND_SEARCH_WORDS = {
    crypto: ['crypto', 'cryptocurrency', 'bitcoin', 'exchange'],
    broker: ['broker', 'brokerage', 'shares', 'stocks', 'investing', 'trading'],
    fintech: ['fintech', 'neobank', 'digital']
};

// --- Logged-in user ---
// SINGLE SOURCE OF TRUTH for who is signed in. In production this is the
// object returned by the login/auth response. Change `name` and everything
// follows: the avatar initials (Jared A -> "JA", Marwan Rem -> "MR"), the
// "Welcome back" greeting and the Account screen.
const USER = {
    name: 'Jared A',
    email: 'jared@example.com',
    memberSince: 'Jan 2025'
};

// Default preferences on the Account screen (saved changes are applied in storage.js).
// showSampleData: true shows the made-up demo accounts and history; false shows only
// the user's own accounts ("start fresh").
const USER_SETTINGS = { faceIdLock: true, notifications: true, showSampleData: true };

// --- Portfolio valuation and currency conversion ---

// SINGLE SOURCE OF TRUTH for every account and its balance.
// To change a balance, edit the `balance` number on that account's line and
// nothing else: the Accounts tab, net-worth total and
// currency menu are all generated from this array. `balance` is in the
// account's own native currency. In production this would come from the
// connected-account API.
// The accounts below are SAMPLE data (read-only). They're removed on start-up
// when "Show sample data" is off (storage.js); the user's own accounts are added after them.
// `group` and `kind` are explained in accounttypes.js. Debts have a negative balance.
const ACCOUNTS = [
    { id: 'westpac', name: 'Westpac (AUS)',       type: 'Checking',            letter: 'W', color: '#DA1710', balance: 35120, currency: 'AUD', domain: 'westpac.com.au' },
    { id: 'bbva',    name: 'BBVA (ESP)',          type: 'Savings',             letter: 'B', color: '#004481', balance: 42800, currency: 'EUR', domain: 'bbva.com' },
    { id: 'revolut', name: 'Revolut (UK)',        type: 'Multi-Currency',      letter: 'R', color: '#191C1F', balance: 12400, currency: 'GBP', domain: 'revolut.com' },
    { id: 'crypto',  name: 'Crypto.com (US)',     type: 'Digital Assets',      letter: 'C', color: '#111827', balance: 15400, currency: 'USD', domain: 'crypto.com', group: 'investments' },
    { id: 'wise',    name: 'Wise (EU)',           type: 'Business Account',    letter: 'T', color: '#00A3E0', balance: 8450,  currency: 'EUR', domain: 'wise.com' },
    { id: 'ibkr',    name: 'Interactive Brokers', type: 'Brokerage Portfolio', letter: 'I', color: '#F58220', balance: 34280, currency: 'AUD', domain: 'interactivebrokers.com', group: 'investments' },
    { id: 'home',     name: 'Home, Sydney',       type: 'Property',    letter: 'H', color: '#0F766E', balance: 1150000, currency: 'AUD', group: 'assets', kind: 'property',   history: sampleMonthlyHistory(1150000, -3800) },
    { id: 'car',      name: 'Tesla Model 3',      type: 'Vehicle',     letter: 'T', color: '#475569', balance: 48000,   currency: 'AUD', group: 'assets', kind: 'vehicle',    history: sampleMonthlyHistory(48000, 650) },
    { id: 'mortgage', name: 'Home loan',          type: 'Mortgage',    letter: 'H', color: '#9F1239', balance: -742000, currency: 'AUD', group: 'debts',  kind: 'mortgage',   linkedTo: 'home', history: sampleMonthlyHistory(-742000, -1900) },
    { id: 'visa',     name: 'Westpac Credit Card', type: 'Credit card', letter: 'W', color: '#DA1710', balance: -3200,  currency: 'AUD', group: 'debts',  kind: 'creditCard', domain: 'westpac.com.au', history: sampleMonthlyHistory(-3200, 0) }
];

// Monthly values for a sample asset or debt, going back past the start of the sample history.
// `changePerMonthAgo` is how much the value differed for each month further back.
function sampleMonthlyHistory(balance, changePerMonthAgo) {
    const history = [];
    for (let monthsAgo = 16; monthsAgo >= 1; monthsAgo--) {
        const day = new Date();
        day.setDate(1);
        day.setMonth(day.getMonth() - monthsAgo);
        const date = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-01';
        history.push({ date: date, balance: balance + changePerMonthAgo * monthsAgo });
    }
    return history;
}

// All exchange rates are stored as "1 AUD = X of this currency". This makes
// every account comparable: native balance -> AUD -> selected display currency.
const BASE_CURRENCY = 'AUD';

// Every currency the app supports: the ones the European Central Bank publishes a daily
// reference rate for (via Frankfurter, see rates.js). Order = order in every picker.
// `fallback` is the ECB rate from 30 Oct 2026 ("1 AUD = X"), used only until live rates load
// (or if they can't load). Live rates replace them within a second or two of opening.
// To add a currency: add a line here; it must be one the ECB publishes.
const CURRENCIES = [
    { code: 'AUD', name: 'Australian Dollar',  symbol: '$',   flag: '🇦🇺', fallback: 1 },
    { code: 'USD', name: 'US Dollar',          symbol: '$',   flag: '🇺🇸', fallback: 0.70246 },
    { code: 'EUR', name: 'Euro',               symbol: '€',   flag: '🇪🇺', fallback: 0.62877 },
    { code: 'GBP', name: 'British Pound',      symbol: '£',   flag: '🇬🇧', fallback: 0.52427 },
    { code: 'JPY', name: 'Japanese Yen',       symbol: '¥',   flag: '🇯🇵', fallback: 110.46 },
    { code: 'CAD', name: 'Canadian Dollar',    symbol: '$',   flag: '🇨🇦', fallback: 0.98126 },
    { code: 'NZD', name: 'New Zealand Dollar', symbol: '$',   flag: '🇳🇿', fallback: 1.2464 },
    { code: 'CHF', name: 'Swiss Franc',        symbol: 'Fr ', flag: '🇨🇭', fallback: 0.57809 },
    { code: 'SGD', name: 'Singapore Dollar',   symbol: '$',   flag: '🇸🇬', fallback: 0.89801 },
    { code: 'HKD', name: 'Hong Kong Dollar',   symbol: '$',   flag: '🇭🇰', fallback: 5.5113 },
    { code: 'CNY', name: 'Chinese Yuan',       symbol: '¥',   flag: '🇨🇳', fallback: 4.6734 },
    { code: 'INR', name: 'Indian Rupee',       symbol: '₹',   flag: '🇮🇳', fallback: 66.7 },
    { code: 'KRW', name: 'South Korean Won',   symbol: '₩',   flag: '🇰🇷', fallback: 937.98 },
    { code: 'IDR', name: 'Indonesian Rupiah',  symbol: 'Rp',  flag: '🇮🇩', fallback: 12748 },
    { code: 'MYR', name: 'Malaysian Ringgit',  symbol: 'RM',  flag: '🇲🇾', fallback: 2.8499 },
    { code: 'PHP', name: 'Philippine Peso',    symbol: '₱',   flag: '🇵🇭', fallback: 44.733 },
    { code: 'THB', name: 'Thai Baht',          symbol: '฿',   flag: '🇹🇭', fallback: 23.694 },
    { code: 'SEK', name: 'Swedish Krona',      symbol: 'kr ', flag: '🇸🇪', fallback: 6.9027 },
    { code: 'NOK', name: 'Norwegian Krone',    symbol: 'kr ', flag: '🇳🇴', fallback: 6.4839 },
    { code: 'DKK', name: 'Danish Krone',       symbol: 'kr ', flag: '🇩🇰', fallback: 4.6991 },
    { code: 'ISK', name: 'Icelandic Króna',    symbol: 'kr ', flag: '🇮🇸', fallback: 85.51 },
    { code: 'PLN', name: 'Polish Złoty',       symbol: 'zł ', flag: '🇵🇱', fallback: 2.769 },
    { code: 'CZK', name: 'Czech Koruna',       symbol: 'Kč ', flag: '🇨🇿', fallback: 15.3125 },
    { code: 'HUF', name: 'Hungarian Forint',   symbol: 'Ft ', flag: '🇭🇺', fallback: 230.34 },
    { code: 'RON', name: 'Romanian Leu',       symbol: 'lei ', flag: '🇷🇴', fallback: 3.3606 },
    { code: 'TRY', name: 'Turkish Lira',       symbol: '₺',   flag: '🇹🇷', fallback: 35.087 },
    { code: 'ILS', name: 'Israeli Shekel',     symbol: '₪',   flag: '🇮🇱', fallback: 2.1976 },
    { code: 'ZAR', name: 'South African Rand', symbol: 'R ',  flag: '🇿🇦', fallback: 11.7238 },
    { code: 'MXN', name: 'Mexican Peso',       symbol: '$',   flag: '🇲🇽', fallback: 13.2822 },
    { code: 'BRL', name: 'Brazilian Real',     symbol: 'R$',  flag: '🇧🇷', fallback: 3.8161 }
];

// Built from CURRENCIES so the rest of the app can look things up by code.
const EXCHANGE_RATES = {};
const CURRENCY_META = {};
CURRENCIES.forEach(c => {
    EXCHANGE_RATES[c.code] = c.fallback;
    CURRENCY_META[c.code] = { symbol: c.symbol, flag: c.flag, name: c.name };
});
