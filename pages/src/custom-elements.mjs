
export const themes = [
    {id: "sauce", name: "Sauce Default"},
    {id: "bluepink", name: "Ice Blue Pink"},
    {id: "green", name: "Green Lantern"},
    {id: "burgundy", name: "Ron Burgundy"},
    {id: "aqua", name: "Aqua Salad"},
    {id: "watermelon", name: "Watermelon"},
    {id: "light", name: "Light"},
    {id: "dark", name: "Dark"},
    {id: "transparent-light", name: "Light", group: "Transparent"},
    {id: "transparent-dark", name: "Dark", group: "Transparent"},
    {id: "semi-transparent-dark", name: "Semi", group: "Transparent"},
    {id: "gpt-vibrant", name: "Vibrant", group: "AI Generated"},
    {id: "gpt-sunset", name: "Sunset", group: "AI Generated"},
];

class ThemeSelect extends HTMLSelectElement {
    constructor() {
        super();
        this.setAttribute('name', this.hasAttribute('override') ? 'themeOverride' : '/theme');
        this.render();
    }

    render() {
        const _themes = this.hasAttribute('override') ?
            [{id: '', name: 'Use app setting'}, ...themes] :
            themes.map(x => x.id === 'sauce' ? {...x, id: ''} : x);
        const groups = new Map();
        for (const x of _themes) {
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
customElements.define('sauce-theme', ThemeSelect, {extends: 'select'});


class RowEditor extends HTMLElement {
    constructor() {
        super();
        this.style.setProperty('--columns', this.querySelector('row').children.length);
        this.addEventListener('click', this.onClick.bind(this));
        this.addEventListener('input', this.onInput.bind(this));
        this.addEventListener('select', this.onSelect.bind(this));
    }

    onClick(ev) {
        if (ev.target.closest('a[remove]')) {
            debugger;
        } else if (ev.target.closest('a[add]')) {
            debugger;
        }
    }

    onInput(ev) {
        debugger;
    }

    onSelect(ev) {
        debugger;
    }
}
customElements.define('sauce-row-editor', RowEditor);
