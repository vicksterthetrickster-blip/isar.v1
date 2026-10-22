// cards.js — Cards tab (wallet card stack).

// Apple Wallet Card Stacking Interaction
let activeCardIndex = 0;
function cycleWalletCards() {
    const cards = document.querySelectorAll('.wallet-card');
    activeCardIndex = (activeCardIndex + 1) % cards.length;
    
    cards.forEach((card, index) => {
        let pos = (index - activeCardIndex + cards.length) % cards.length;
        if (pos === 0) {
            card.style.top = '0px';
            card.style.transform = 'scale(1)';
            card.style.opacity = '1';
            card.style.zIndex = '10';
        } else {
            card.style.top = (pos * 28) + 'px';
            card.style.transform = `scale(${1 - pos * 0.04})`;
            card.style.opacity = `${1 - pos * 0.25}`;
            card.style.zIndex = `${10 - pos}`;
        }
    });
}
