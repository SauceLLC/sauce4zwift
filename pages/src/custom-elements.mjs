
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
    {id: "gpt-vibrant", name: "Vibrant", group: "AI Generated"},
    {id: "gpt-sunset", name: "Sunset", group: "AI Generated"},
];

class ThemeSelect extends HTMLSelectElement {
    constructor() {
        super();
        let _themes;
        let name;
        if (this.hasAttribute('override')) {
            _themes = [{id: '', name: 'Use app setting'}, ...themes];
            name = 'themeOverride';
        } else {
            _themes = themes.map(x => x.id === 'sauce' ? {...x, id: ''} : x);
            name = '/theme';
        }
        this.setAttribute('name', name);
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
}

customElements.define('sauce-theme', ThemeSelect, {extends: 'select'});
