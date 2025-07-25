import { AKElement } from "#elements/Base";

import { css, html } from "lit";
import { customElement } from "lit/decorators.js";

const style = css`
    div {
        grid-column: 1 / -1;
        font-size: var(--ak-hint__body--FontSize);
    }
`;

@customElement("ak-hint-body")
export class AkHintBody extends AKElement {
    static styles = [style];

    render() {
        return html`<div part="ak-hint-body"><slot></slot></div>`;
    }
}

export default AkHintBody;

declare global {
    interface HTMLElementTagNameMap {
        "ak-hint-body": AkHintBody;
    }
}
