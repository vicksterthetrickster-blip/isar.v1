// data.js — fixed app data: bank list, user, accounts, currencies.
// Loaded first. Other files read these values; nothing here touches the page.

// Top 40 Global Banks Database Mockup
const topBanks = [
    { name: "JPMorgan Chase", code: "JPM", color: "#1D4ED8" },
    { name: "Bank of America", code: "BAC", color: "#DC2626" },
    { name: "Industrial and Commercial Bank of China", code: "ICBC", color: "#B91C1C" },
    { name: "China Construction Bank", code: "CCB", color: "#0369A1" },
    { name: "Agricultural Bank of China", code: "ABC", color: "#047857" },
    { name: "HSBC Holdings", code: "HSBC", color: "#E11D48" },
    { name: "Citigroup", code: "CITI", color: "#0284C7" },
    { name: "Bank of China", code: "BOC", color: "#C53030" },
    { name: "Mitsubishi UFJ Financial Group", code: "MUFG", color: "#D97706" },
    { name: "Wells Fargo", code: "WFC", color: "#B45309" },
    { name: "BNP Paribas", code: "BNP", color: "#0EA5E9" },
    { name: "Goldman Sachs", code: "GS", color: "#475569" },
    { name: "Morgan Stanley", code: "MS", color: "#334155" },
    { name: "UBS Group", code: "UBS", color: "#C2410C" },
    { name: "Banco Santander", code: "SAN", color: "#EF4444" },
    { name: "State Street Corporation", code: "STT", color: "#0F766E" },
    { name: "Toronto-Dominion Bank", code: "TD", color: "#15803D" },
    { name: "BBVA", code: "BBVA", color: "#004481" },
    { name: "Intesa Sanpaolo", code: "ISP", color: "#1D4ED8" },
    { name: "Scotiabank", code: "BNS", color: "#B91C1C" },
    { name: "Commonwealth Bank", code: "CBA", color: "#FACC15" },
    { name: "Westpac", code: "WBC", color: "#DA1710" },
    { name: "ANZ Bank", code: "ANZ", color: "#008559" },
    { name: "National Australia Bank", code: "NAB", color: "#DC2626" },
    { name: "Credit Agricole", code: "ACA", color: "#1E3A8A" },
    { name: "Societe Generale", code: "GLE", color: "#C2410C" },
    { name: "Standard Chartered", code: "STAN", color: "#0284C7" },
    { name: "Nomura Holdings", code: "NMR", color: "#B45309" },
    { name: "BNY Mellon", code: "BK", color: "#475569" },
    { name: "PNC Financial Services", code: "PNC", color: "#1E40AF" },
    { name: "Truist Financial", code: "TFC", color: "#7E22CE" },
    { name: "Quebec National Bank", code: "NB", color: "#047857" },
    { name: "Nordea", code: "NDA", color: "#003755" },
    { name: "Rabobank", code: "RABO", color: "#FF6600" },
    { name: "Commerzbank", code: "CBK", color: "#F59E0B" },
    { name: "Deutsche Bank", code: "DB", color: "#001A6E" },
    { name: "Barclays", code: "BARC", color: "#00AEEF" },
    { name: "NatWest Group", code: "NWG", color: "#581C87" },
    { name: "Lloyds Banking Group", code: "LLOY", color: "#006A4E" },
    { name: "Monzo", code: "M", color: "#FF5964" }
];

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
// nothing else: the Accounts tab, Transfer dropdowns, net-worth total and
// currency menu are all generated from this array. `balance` is in the
// account's own native currency. In production this would come from the
// connected-account API.
// The six accounts below are SAMPLE data (read-only). They're removed on start-up
// when "Show sample data" is off (storage.js); the user's own accounts are added after them.
const ACCOUNTS = [
    { id: 'westpac', name: 'Westpac (AUS)',       type: 'Checking',            letter: 'W', color: '#DA1710', balance: 35120, currency: 'AUD' },
    { id: 'bbva',    name: 'BBVA (ESP)',          type: 'Savings',             letter: 'B', color: '#004481', balance: 42800, currency: 'EUR' },
    { id: 'revolut', name: 'Revolut (UK)',        type: 'Multi-Currency',      letter: 'R', color: '#191C1F', balance: 12400, currency: 'GBP' },
    { id: 'crypto',  name: 'Crypto.com (US)',     type: 'Digital Assets',      letter: 'C', color: '#111827', balance: 15400, currency: 'USD' },
    { id: 'wise',    name: 'Wise (EU)',           type: 'Business Account',    letter: 'T', color: '#00A3E0', balance: 8450,  currency: 'EUR' },
    { id: 'ibkr',    name: 'Interactive Brokers', type: 'Brokerage Portfolio', letter: 'I', color: '#F58220', balance: 34280, currency: 'AUD' }
];

// How many accounts show before the "+ N accounts" toggle is opened.
const VISIBLE_ACCOUNT_COUNT = 4;

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
