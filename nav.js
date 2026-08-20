document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.hero').forEach((hero, index) => {
        const nav = hero.querySelector('.nav-actions');
        const heroText = hero.querySelector('.hero-text');
        if (!nav || !heroText) return;

        const navId = nav.id || `site-navigation-${index + 1}`;
        nav.id = navId;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'nav-toggle';
        toggle.setAttribute('aria-controls', navId);
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open navigation menu');
        toggle.innerHTML = '<span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span>';
        heroText.insertAdjacentElement('afterend', toggle);
        hero.classList.add('mobile-nav-ready');

        const setOpen = (open) => {
            hero.classList.toggle('nav-open', open);
            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
        };

        toggle.addEventListener('click', () => setOpen(!hero.classList.contains('nav-open')));
        nav.addEventListener('click', (event) => {
            if (event.target.closest('a')) setOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') setOpen(false);
        });
        document.addEventListener('click', (event) => {
            if (!hero.contains(event.target)) setOpen(false);
        });
    });
});
