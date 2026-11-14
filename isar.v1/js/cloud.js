// cloud.js — keeps your saved data in your Isar account online (Supabase), so it's the same on
// every device and survives deleting the app.
//
// How it works:
//   - The app still saves on this device first (storage.js), so it opens instantly and works offline.
//   - About 2 seconds after a change, the whole saved bundle is uploaded to YOUR row in the
//     `user_data` table. The database rules only let you read and change your own row.
//   - On start-up, if your row was changed on another device since this one last synced, that
//     newer copy is used instead (the app reloads once to show it).
//   - If both changed (e.g. you edited offline here and online elsewhere), the newer change wins.
// The demo and the sign-in screens never touch the cloud.

const CLOUD_TABLE = 'user_data';
const CLOUD_UPLOAD_DELAY_MS = 2000;

function cloudMetaKeyFor(session) {
    return 'isar.cloudSync.v1.user-' + session.userId;
}

// What this device knows about syncing:
//   version  the row's `updated_at` when this device last downloaded or uploaded it
//   dirtyAt  when the first change that hasn't been uploaded yet was made (null = all uploaded)
const CLOUD_META_KEY = AUTH_SESSION && !AUTH_SESSION.demo ? cloudMetaKeyFor(AUTH_SESSION) : null;

function readCloudMeta(key) {
    try {
        const meta = JSON.parse(localStorage.getItem(key));
        return meta && typeof meta === 'object' ? meta : {};
    } catch (e) {
        return {};
    }
}

let cloudMeta = CLOUD_META_KEY ? readCloudMeta(CLOUD_META_KEY) : {};
const CLOUD_META_AT_START = Object.assign({}, cloudMeta);   // as it was before this visit changed anything
let cloudReady = false;           // true once start-up has compared this device with the online copy
let cloudChanges = 0;             // counts changes, so one made during an upload isn't forgotten
let cloudUploadTimer = null;
let cloudUploading = null;        // the upload in progress, if any

function writeCloudMeta() {
    if (!CLOUD_META_KEY) return;
    try { localStorage.setItem(CLOUD_META_KEY, JSON.stringify(cloudMeta)); } catch (e) {}
}

function usesCloud() {
    return !!SUPABASE_CLIENT && !!CLOUD_META_KEY;
}

// Called by saveData() after every save. Even offline, the change is noted for later.
function noteCloudChange() {
    if (!CLOUD_META_KEY) return;
    cloudChanges++;
    if (!cloudMeta.dirtyAt) {
        cloudMeta.dirtyAt = new Date().toISOString();
        writeCloudMeta();
    }
    if (!cloudReady) return;                  // start-up compares with the online copy first
    clearTimeout(cloudUploadTimer);
    cloudUploadTimer = setTimeout(uploadToCloud, CLOUD_UPLOAD_DELAY_MS);
    setCloudStatus('saving');
}

async function uploadToCloud() {
    clearTimeout(cloudUploadTimer);
    if (!usesCloud() || !cloudReady || !cloudMeta.dirtyAt) return;
    if (cloudUploading) await cloudUploading;   // one at a time
    if (!cloudMeta.dirtyAt) return;
    const changesAtStart = cloudChanges;
    cloudUploading = (async () => {
        const { data, error } = await SUPABASE_CLIENT.from(CLOUD_TABLE)
            .upsert({ user_id: AUTH_SESSION.userId, data: SAVED, updated_at: new Date().toISOString() })
            .select('updated_at')
            .single();
        if (error) throw error;
        cloudMeta.version = data.updated_at;
        if (cloudChanges === changesAtStart) cloudMeta.dirtyAt = null;
        writeCloudMeta();
    })();
    try {
        await cloudUploading;
        setCloudStatus(cloudMeta.dirtyAt ? 'saving' : 'saved');
    } catch (e) {
        console.warn('Could not upload your data; it will try again later.', e);
        setCloudStatus('offline');
    } finally {
        cloudUploading = null;
    }
    if (cloudMeta.dirtyAt && cloudChanges !== changesAtStart) uploadToCloud();
}

// Uploads anything waiting, straight away (before signing out, or when the app is closed).
async function flushCloudUpload() {
    if (cloudReady && cloudMeta.dirtyAt) await uploadToCloud();
}

async function fetchCloudRow(userId) {
    const { data, error } = await SUPABASE_CLIENT.from(CLOUD_TABLE).select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;              // null = nothing saved online yet
}

// Used when signing in: puts your online copy on this device before the app opens, unless this
// device has newer changes that never uploaded.
async function downloadCloudDataFor(session) {
    if (!SUPABASE_CLIENT) return;
    try {
        const row = await fetchCloudRow(session.userId);
        if (!row) return;
        const meta = readCloudMeta(cloudMetaKeyFor(session));
        if (meta.dirtyAt && new Date(meta.dirtyAt) > new Date(row.updated_at)) return;
        localStorage.setItem(savedDataKeyFor(session), JSON.stringify(row.data));
        localStorage.setItem(cloudMetaKeyFor(session), JSON.stringify({ version: row.updated_at, dirtyAt: null }));
    } catch (e) {
        console.warn('Could not download your data yet; it will be fetched when the app opens.', e);
    }
}

// On start-up (main.js): compare this device with the online copy, then keep uploading changes.
function startCloudSync() {
    if (!CLOUD_META_KEY) return;
    window.addEventListener('online', keepCloudInSync);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushCloudUpload(); });
    syncWithCloud();
}

// Every few minutes and when the internet comes back: finish whatever is waiting.
function keepCloudInSync() {
    if (!CLOUD_META_KEY) return;
    if (!cloudReady) syncWithCloud();
    else uploadToCloud();
}

async function syncWithCloud() {
    if (!usesCloud()) return setCloudStatus('offline');
    let row;
    try {
        row = await fetchCloudRow(AUTH_SESSION.userId);
    } catch (e) {
        console.warn('Could not reach your online data; using this device\'s copy for now.', e);
        return setCloudStatus('offline');
    }
    if (cloudReady) return;               // another check finished first

    // Nothing online yet: this is a new account, so upload what's here.
    if (!row) {
        cloudReady = true;
        if (!cloudMeta.dirtyAt) { cloudMeta.dirtyAt = new Date().toISOString(); writeCloudMeta(); }
        await uploadToCloud();
        offerDataFromBefore();
        return;
    }

    const changedElsewhere = row.updated_at !== CLOUD_META_AT_START.version;
    const newerHere = !!CLOUD_META_AT_START.dirtyAt && new Date(CLOUD_META_AT_START.dirtyAt) > new Date(row.updated_at);
    if (changedElsewhere && !newerHere) {
        // Another device saved something newer: use that copy and reload to show it.
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(row.data)); } catch (e) { return setCloudStatus('offline'); }
        cloudMeta = { version: row.updated_at, dirtyAt: null };
        writeCloudMeta();
        location.reload();
        return;
    }
    cloudReady = true;
    if (cloudMeta.dirtyAt) await uploadToCloud();
    else setCloudStatus('saved');
    offerDataFromBefore();
}

// --- Bringing over data from the old on-device accounts ---
// Before real accounts, sign-in was pretend and data was saved under a made-up id on this
// device. While your account has no accounts yet, each device that has old data offers it once
// (e.g. you created the account in Safari, then signed in on the home-screen app).
function findDataFromBefore() {
    let best = null;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            // Old ids were short letters and numbers; real accounts' ids contain dashes, and those are never offered.
            if (key !== 'isar.savedData.v1' && !/^isar\.savedData\.v1\.user-[a-z0-9]+$/.test(key)) continue;
            const data = JSON.parse(localStorage.getItem(key));
            const count = data && Array.isArray(data.linkedAccounts) ? data.linkedAccounts.length : 0;
            if (count && (!best || count > best.count)) best = { key: key, data: data, count: count };
        }
    } catch (e) {}
    return best;
}

function offerDataFromBefore() {
    if (cloudMeta.importOffered || SAVED.linkedAccounts.length) return;
    const found = findDataFromBefore();
    if (!found) return;
    cloudMeta.importOffered = true;           // asked once per device, whatever the answer
    writeCloudMeta();
    showConfirmDialog('Bring over your data from this phone?',
        'Isar found ' + found.count + (found.count === 1 ? ' account' : ' accounts') + ' you added before real sign-in existed. They\'ll be saved to your new account.',
        'Bring it over', () => {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, found.data, { setupDone: true }))); } catch (e) { return; }
            cloudMeta.dirtyAt = new Date().toISOString();       // uploads after the reload
            writeCloudMeta();
            location.reload();
        });
}

// --- "Saved to your account" line on the Account screen ---
function setCloudStatus(status) {
    const el = document.getElementById('profile-sync');
    if (!el) return;
    el.hidden = !CLOUD_META_KEY;
    el.innerText = {
        saved: '✓ Saved to your account',
        saving: 'Saving to your account…',
        offline: 'Offline · changes upload when you\'re back online'
    }[status] || '';
}
