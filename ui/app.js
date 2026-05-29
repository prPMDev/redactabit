// Minimal nav switching so you can click through the sections.
// (Real redaction interactivity comes when the engine is wired in.)
const navLinks = document.querySelectorAll('.nav a');
const screens = document.querySelectorAll('[data-screen]');

function show(name) {
  navLinks.forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  screens.forEach(s => { s.style.display = (s.dataset.screen === name) ? '' : 'none'; });
}

navLinks.forEach(a => a.addEventListener('click', (e) => {
  e.preventDefault();
  show(a.dataset.nav);
}));

show('redact');
