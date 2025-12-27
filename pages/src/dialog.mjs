/* global electron */

function main() {
    const options = electron.context.spec.options;
    if (options.confirm || options.cancel) {
        if (options.confirm) {
            const confirmBtn = document.querySelector('.button.confirm');
            confirmBtn.addEventListener('click', ev => {
                ev.preventDefault();
                electron.ipcInvoke('confirm-dialog-response', true);
            });
            if (options.confirmButton) {
                confirmBtn.innerHTML = options.confirmButton;
            }
            if (options.confirmClass) {
                confirmBtn.classList.add(options.confirmClass);
            }
            confirmBtn.classList.remove('hidden');
        }
        if (options.cancel !== false) {
            const cancelBtn = document.querySelector('.button.cancel');
            cancelBtn.addEventListener('click', ev => {
                ev.preventDefault();
                electron.ipcInvoke('confirm-dialog-response', false);
            });
            if (options.cancelButton) {
                cancelBtn.innerHTML = options.cancelButton;
            }
            if (options.cancelClass) {
                cancelBtn.classList.add(options.cancelClass);
            }
            cancelBtn.classList.remove('hidden');
        }
        document.getElementById('buttons').classList.remove('hidden');
    }
    document.addEventListener('set-content', ev => setContent(ev.detail.key, ev.detail.value));
    for (const key of ['title', 'message', 'detail', 'footer']) {
        const value = electron.getContent(key);
        if (value) {
            setContent(key, value);
        }
    }
}


function setContent(key, value) {
    if (key === 'title') {
        document.querySelector('head > title').textContent = value;
    } else if (key === 'message') {
        document.querySelector('#message').innerHTML = value;
    } else if (key === 'detail') {
        document.querySelector('#detail').innerHTML = value;
    } else if (key === 'footer') {
        document.querySelector('footer').innerHTML = value;
    } else {
        throw new TypeError("Invalid key");
    }
}

main();
