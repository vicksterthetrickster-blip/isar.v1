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
const USER_SETTINGS = { faceIdLock: true, notifications: true };

// --- Portfolio valuation and currency conversion ---

// SINGLE SOURCE OF TRUTH for every account and its balance.
// To change a balance, edit the `balance` number on that account's line and
// nothing else: the Accounts tab, Transfer dropdowns, net-worth total and
// currency menu are all generated from this array. `balance` is in the
// account's own native currency. In production this would come from the
// connected-account API.
const ACCOUNTS = [
    { id: 'westpac', name: 'Westpac (AUS)',       type: 'Checking',            letter: 'W', color: '#DA1710', balance: 100000, currency: 'AUD' },
    { id: 'bbva',    name: 'BBVA (ESP)',          type: 'Savings',             letter: 'B', color: '#004481', balance: 20000, currency: 'EUR' },
    { id: 'revolut', name: 'Revolut (UK)',        type: 'Multi-Currency',      letter: 'R', color: '#191C1F', balance: 30000, currency: 'GBP' },
    { id: 'crypto',  name: 'Crypto.com (US)',     type: 'Digital Assets',      letter: 'C', color: '#111827', balance: 40000, currency: 'USD' },
    { id: 'wise',    name: 'Wise (EU)',           type: 'Business Account',    letter: 'T', color: '#00A3E0', balance: 50000,  currency: 'EUR' },
    { id: 'ibkr',    name: 'Interactive Brokers', type: 'Brokerage Portfolio', letter: 'I', color: '#F58220', balance: 60000, currency: 'AUD' }
];

// How many accounts show before the "+ N accounts" toggle is opened.
const VISIBLE_ACCOUNT_COUNT = 4;

// All exchange rates are stored as "1 AUD = X of this currency". This makes
// every account comparable: native balance -> AUD -> selected display currency.
const BASE_CURRENCY = 'AUD';
const EXCHANGE_RATES = {
    AUD: 1,
    USD: 0.658,
    GBP: 0.514,
    EUR: 0.602
};

const CURRENCY_META = {
    AUD: { symbol: '$', flag: '🇦🇺' },
    USD: { symbol: '$', flag: '🇺🇸' },
    GBP: { symbol: '£', flag: '🇬🇧' },
    EUR: { symbol: '€', flag: '🇪🇺' }
};
