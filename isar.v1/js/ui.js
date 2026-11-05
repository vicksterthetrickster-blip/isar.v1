// ui.js — app-wide touch behaviour that makes Isar feel like a native app:
// menus that close themselves, slide-over screens with iOS-style swipe-back, and an
// in-app confirmation pop-up (instead of the browser's own confirm() box).
// Only defines functions; main.js calls the init* functions on start-up.

// --- Drop-down menus ---
// Each menu with the element that opens it. Tapping anywhere else closes it.
const MENU_TRIGGERS = [
    ['curr-menu', 'curr-btn'],
    ['acct-curr-menu', 'acct-curr-btn'],
    ['bank-results', 'bank-search']
];

function closeAllMenus() {
    document.querySelectorAll('.dropdown-menu.open').forEach(m => m.classList.remove('open'));
    const results = document.getElementById('bank-results');
    if (results) results.style.display = 'none';
}

function initDismissMenus() {
    document.addEventListener('pointerdown', e => {
        MENU_TRIGGERS.forEach(([menuId, triggerId]) => {
            const menu = document.getElementById(menuId), trigger = document.getElementById(triggerId);
            if (!menu || menu.contains(e.target) || (trigger && trigger.contains(e.target))) return;
            if (menuId === 'bank-results') menu.style.display = 'none';
            else menu.classList.remove('open');
        });
    }, true);
}

// --- Slide-over screens ---
// The function that closes each screen (used by swipe-back).
const SCREEN_CLOSERS = {
    'account-screen': () => closeAccount(),
    'perf-screen': () => closePerformance(),
    'profile-screen': () => closeProfile()
};

// Watches the screens: whenever one opens or closes, the app behind it slides aside or back
// (the .screen-open class in styles.css) and any open menu is closed.
function initScreenTransitions() {
    const frame = document.querySelector('.phone-frame');
    const screens = Object.keys(SCREEN_CLOSERS).map(id => document.getElementById(id));
    const update = () => {
        frame.classList.toggle('screen-open', screens.some(s => s.classList.contains('open')));
        closeAllMenus();
    };
    const observer = new MutationObserver(update);
    screens.forEach(s => observer.observe(s, { attributes: true, attributeFilter: ['class'] }));
}

// iOS-style swipe-back: drag from the left edge of a screen to the right to close it.
// Past a third of the width (or a quick flick) it closes; otherwise it springs back.
const SWIPE_EDGE_PX = 28;

function initSwipeBack() {
    Object.keys(SCREEN_CLOSERS).forEach(id => {
        const screen = document.getElementById(id);
        let startX = null, startY = 0, startTime = 0, dx = 0, dragging = false;

        screen.addEventListener('touchstart', e => {
            const t = e.touches[0];
            const left = screen.getBoundingClientRect().left;
            if (e.touches.length !== 1 || t.clientX - left > SWIPE_EDGE_PX) return;
            startX = t.clientX; startY = t.clientY; startTime = Date.now(); dx = 0; dragging = false;
        }, { passive: true });

        screen.addEventListener('touchmove', e => {
            if (startX === null) return;
            const t = e.touches[0];
            dx = Math.max(0, t.clientX - startX);
            if (!dragging) {
                if (Math.abs(t.clientY - startY) > Math.abs(dx)) { startX = null; return; }   // vertical scroll, not a swipe
                if (dx < 6) return;
                dragging = true;
                screen.style.transition = 'none';
            }
            screen.style.transform = 'translateX(' + dx + 'px)';
            e.preventDefault();
        }, { passive: false });

        const finish = () => {
            if (startX === null) return;
            startX = null;
            if (!dragging) return;
            const fast = dx / Math.max(1, Date.now() - startTime) > 0.5;
            screen.style.transition = '';
            screen.style.transform = '';        // the CSS transition carries it on from where the finger let go
            if (dx > screen.offsetWidth / 3 || fast) SCREEN_CLOSERS[id]();
        };
        screen.addEventListener('touchend', finish);
        screen.addEventListener('touchcancel', finish);
    });
}

// --- In-app confirmation pop-up ---
// Replaces the browser's confirm(), which shows the website address and looks out of place.
// `onConfirm` runs only if the user taps the confirm button.
let pendingConfirm = null;

function showConfirmDialog(title, message, confirmLabel, onConfirm) {
    pendingConfirm = onConfirm;
    document.getElementById('modal-content-box').innerHTML =
        '<div>' +
            '<h3 style="font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px;">' + escapeHTML(title) + '</h3>' +
            '<p style="font-size: 12px; color: #A1A1AA; line-height: 1.4;">' + escapeHTML(message) + '</p>' +
        '</div>' +
        '<div style="display: flex; gap: 10px;">' +
            '<button onclick="cancelConfirmDialog()" class="interactive-btn" style="flex: 1; background: #27272A; border: none; border-radius: 12px; padding: 12px; color: #fff; font-size: 13px; font-weight: 600;">Cancel</button>' +
            '<button onclick="acceptConfirmDialog()" class="interactive-btn" style="flex: 1; background: #FF4D6D; border: none; border-radius: 12px; padding: 12px; color: #000; font-size: 13px; font-weight: 700;">' + escapeHTML(confirmLabel) + '</button>' +
        '</div>';
    document.getElementById('secure-modal').style.display = 'flex';
}

function cancelConfirmDialog() {
    pendingConfirm = null;
    closeModalAndReset();
}

function acceptConfirmDialog() {
    const action = pendingConfirm;
    pendingConfirm = null;
    closeModalAndReset();
    if (action) action();
}
