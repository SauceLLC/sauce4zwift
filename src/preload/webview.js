const {ipcRenderer} = require('electron');

// TODO: Register these events based on requests from the host renderer.

addEventListener('contextmenu', ev => {
    ipcRenderer.sendToHost('interaction', ev.type);
}, {capture: false});

/*addEventListener('pointerdown', ev => {
    ipcRenderer.sendToHost('interaction', ev.type, {
        button: ev.button,
        buttons: ev.buttons
    });
}, {capture: true});*/


/*addEventListener('wheel', ev => {
    console.log("wheel", ev);
    ipcRenderer.sendToHost('interaction', ev.type, JSON.parse(JSON.stringify(ev)));
});*/
