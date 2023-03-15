const {ipcRenderer} = require('electron');

document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form');
    form.addEventListener('submit', ev => {
        ev.preventDefault();
        ipcRenderer.send('zwift-creds',
                         Object.fromEntries(Array.from(form.elements).map(x => [x.name, x.value])));
        document.documentElement.classList.add('validating');
        document.querySelector('form .error').innerHTML = '';
    });
});

ipcRenderer.on('validation-error', (ev, status) => {
    document.documentElement.classList.remove('validating');
    document.querySelector('form .error').textContent = status;
});
