// The opening screen says something different each time. Change or add lines here: one is picked by chance.
try {
  var lines = ['Chai first. Then work.', 'Running late… like every Monday.', 'Waking up the server. It was sleeping.', 'Asking the internet nicely…',
    'Counting your calls. Please act surprised.', 'Polishing your targets…', 'Warming up the phone lines…', 'Loading… faster than the office lift.',
    'Almost there. Do not spill the chai.', 'Finding where you left off yesterday…'];
  document.getElementById('splash-line').textContent = lines[Math.floor(Math.random() * lines.length)];
} catch (e) {}
