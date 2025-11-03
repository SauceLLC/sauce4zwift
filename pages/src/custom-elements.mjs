
export const themes = [
    {id: "sauce", name: "Sauce Default"},
    {id: "bluepink", name: "Ice Blue Pink"},
    {id: "green", name: "Green Lantern"},
    {id: "burgundy", name: "Ron Burgundy"},
    {id: "aqua", name: "Aqua Salad"},
    {id: "watermelon", name: "Watermelon"},
    {id: "light", name: "Light"},
    {id: "dark", name: "Dark"},
    {id: "gpt-vibrant", name: "Vibrant"},
    {id: "gpt-sunset", name: "Sunset"},
    {id: "red-sun", name: "Red Sun"},
    {id: "blue-moon", name: "Blue Moon"},
    {id: "transparent-light", name: "Light", group: "Transparent"},
    {id: "transparent-dark", name: "Dark", group: "Transparent"},
    {id: "semi-transparent-dark", name: "Semi", group: "Transparent"},
    {id: "forced-background", name: "Forced Background", group: "Transparent"},
];

export const backgroundTextures = [
    {id: "cubism", name: "Cubism", default: true},
    {id: "checkered", name: "Checkered"},
    {id: "maze", name: "Maze"},
    {id: "none", name: "None"},
];


class ThemeSelect extends HTMLSelectElement {

    constructor() {
        super();
        this.setAttribute('name', this.hasAttribute('override') ? 'themeOverride' : '/theme');
        this.render();
    }

    render() {
        const options = this.hasAttribute('override') ?
            [{id: '', name: 'Use app setting'}, ...themes] :
            themes.map(x => x.id === 'sauce' ? {...x, id: ''} : x);
        const groups = new Map();
        for (const x of options) {
            if (!groups.has(x.group)) {
                groups.set(x.group, []);
            }
            groups.get(x.group).push(x);
        }
        for (const [group, entries] of groups.entries()) {
            let parent;
            if (group) {
                parent = document.createElement('optgroup');
                parent.label = group;
                this.append(parent);
            } else {
                parent = this;
            }
            for (const x of entries) {
                const option = document.createElement('option');
                option.value = x.id;
                option.label = x.name;
                parent.append(option);
            }
        }
    }

    update() {
        while (this.childNodes.length) {
            this.removeChild(this.childNodes[0]);
        }
        this.render();
    }
}
window.customElements.define('sauce-theme', ThemeSelect, {extends: 'select'});


class BackgroundTextureSelect extends HTMLSelectElement {

    constructor() {
        super();
        this.setAttribute('name', this.hasAttribute('override') ? 'bgTextureOverride' : '/bgTexture');
        this.render();
    }

    render() {
        const options = this.hasAttribute('override') ? [
            {id: '', name: 'Use app setting', default: true},
            ...backgroundTextures.map(x => ({...x, default: false}))
        ] : backgroundTextures;
        const groups = new Map();
        for (const x of options) {
            if (!groups.has(x.group)) {
                groups.set(x.group, []);
            }
            groups.get(x.group).push(x);
        }
        for (const [group, entries] of groups.entries()) {
            let parent;
            if (group) {
                parent = document.createElement('optgroup');
                parent.label = group;
                this.append(parent);
            } else {
                parent = this;
            }
            for (const x of entries) {
                const option = document.createElement('option');
                option.value = x.id;
                option.label = x.name;
                option.selected = x.default;
                parent.append(option);
            }
        }
    }

    update() {
        this.replaceChildren();
        this.render();
    }
}
window.customElements.define('sauce-background-texture', BackgroundTextureSelect, {extends: 'select'});
