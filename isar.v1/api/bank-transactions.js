// api/bank-transactions.js — the transactions of ONE of your connected bank accounts.
//
// GET /api/bank-transactions?uid=<account uid>&from=YYYY-MM-DD
// The server first checks the account is in one of YOUR connections (read as you, so the
// database only hands over your own), then asks Enable Banking for its transactions since
// `from`, page by page, and turns them into Isar's transaction shape (see js/transactions.js).

import { ebRequest, requireUser, readRowsAsUser } from './_enablebanking.js';

const MAX_PAGES = 20;     // a safety stop; a year of everyday spending is a few pages

function isoDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

// Banks describe a payment in different fields; use the most readable one they filled in.
function describe(tx, moneyIn) {
    const party = moneyIn ? tx.debtor && tx.debtor.name : tx.creditor && tx.creditor.name;
    const remittance = Array.isArray(tx.remittance_information) ? tx.remittance_information.filter(Boolean).join(' ') : '';
    return (party || remittance || tx.note || (tx.bank_transaction_code && tx.bank_transaction_code.description) || (moneyIn ? 'Money in' : 'Money out')).trim().slice(0, 140);
}

function toIsarTransaction(tx, index) {
    const amount = Number(tx.transaction_amount && tx.transaction_amount.amount);
    const date = isoDate(tx.booking_date) || isoDate(tx.transaction_date) || isoDate(tx.value_date);
    if (!Number.isFinite(amount) || !date) return null;

    // Enable Banking gives a positive amount and says separately whether it went in or out.
    const moneyIn = tx.credit_debit_indicator === 'CRDT';
    const signed = Math.abs(amount) * (moneyIn ? 1 : -1);
    const pending = tx.status === 'PDNG';
    const result = {
        id: 'eb-' + (tx.entry_reference || tx.transaction_id || [date, signed, index].join('-')),
        date: date,
        description: describe(tx, moneyIn),
        category: pending ? 'Pending' : ((tx.bank_transaction_code && tx.bank_transaction_code.description) || ''),
        amount: signed
    };

    // A card payment abroad: what was actually spent, which the hidden exchange cost needs.
    const instructed = tx.exchange_rate && tx.exchange_rate.instructed_amount;
    const accountCurrency = tx.transaction_amount.currency;
    if (instructed && instructed.currency && instructed.currency !== accountCurrency && Number.isFinite(Number(instructed.amount))) {
        result.original = { amount: Math.abs(Number(instructed.amount)) * (moneyIn ? 1 : -1), currency: instructed.currency };
    }
    return result;
}

export default async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');

    const user = await requireUser(request);
    if (!user) return response.status(401).json({ ok: false, error: 'Sign in to Isar first.' });

    const uid = String(request.query.uid || '');
    const from = isoDate(String(request.query.from || ''));
    if (!uid || !from) return response.status(400).json({ ok: false, error: 'Missing account or start date.' });

    let connections;
    try {
        connections = await readRowsAsUser(request, 'bank_connections', 'accounts,valid_until');
    } catch (error) {
        return response.status(502).json({ ok: false, error: 'Could not read your connections: ' + error.message });
    }
    const connection = connections.find(c => (c.accounts || []).some(a => a.uid === uid));
    if (!connection) return response.status(404).json({ ok: false, error: 'That account isn\'t one of your connections.' });
    if (connection.valid_until && new Date(connection.valid_until) < new Date()) {
        return response.status(403).json({ ok: false, error: 'consent_expired' });
    }

    const transactions = [];
    let continuation = null;
    try {
        for (let page = 0; page < MAX_PAGES; page++) {
            const query = '?date_from=' + from + (continuation ? '&continuation_key=' + encodeURIComponent(continuation) : '');
            const data = await ebRequest('/accounts/' + encodeURIComponent(uid) + '/transactions' + query);
            (data.transactions || []).forEach(tx => {
                const converted = toIsarTransaction(tx, transactions.length);
                if (converted) transactions.push(converted);
            });
            continuation = data.continuation_key;
            if (!continuation) break;
        }
    } catch (error) {
        return response.status(error.status === 422 || error.status === 400 ? 422 : 502).json({ ok: false, error: error.message });
    }

    response.status(200).json({ ok: true, from: from, transactions: transactions });
}
