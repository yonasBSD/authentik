import { AndNext, DEFAULT_CONFIG } from "@goauthentik/common/api/config";
import { EVENT_REFRESH } from "@goauthentik/common/constants";
import { parseAPIResponseError, pluckErrorDetail } from "@goauthentik/common/errors/network";
import { MessageLevel } from "@goauthentik/common/messages";
import "@goauthentik/elements/Spinner";
import { showMessage } from "@goauthentik/elements/messages/MessageContainer";
import { BaseUserSettings } from "@goauthentik/elements/user/sources/BaseUserSettings";

import { msg, str } from "@lit/localize";
import { TemplateResult, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { SourcesApi } from "@goauthentik/api";

@customElement("ak-user-settings-source-saml")
export class SourceSettingsSAML extends BaseUserSettings {
    @property()
    title!: string;

    @property({ type: Number })
    connectionPk = 0;

    render(): TemplateResult {
        if (this.connectionPk === -1) {
            return html`<ak-spinner></ak-spinner>`;
        }
        if (this.connectionPk > 0) {
            return html`<button
                class="pf-c-button pf-m-danger"
                @click=${() => {
                    return new SourcesApi(DEFAULT_CONFIG)
                        .sourcesUserConnectionsSamlDestroy({
                            id: this.connectionPk,
                        })
                        .then(() => {
                            showMessage({
                                level: MessageLevel.info,
                                message: msg("Successfully disconnected source"),
                            });
                        })
                        .catch(async (error: unknown) => {
                            const parsedError = await parseAPIResponseError(error);

                            showMessage({
                                level: MessageLevel.error,
                                message: msg(
                                    str`Failed to disconnected source: ${pluckErrorDetail(parsedError)}`,
                                ),
                            });
                        })
                        .finally(() => {
                            this.parentElement?.dispatchEvent(
                                new CustomEvent(EVENT_REFRESH, {
                                    bubbles: true,
                                    composed: true,
                                }),
                            );
                        });
                }}
            >
                ${msg("Disconnect")}
            </button>`;
        }
        if (this.configureUrl) {
            return html`<a
                class="pf-c-button pf-m-primary"
                href="${this.configureUrl}${AndNext(
                    `/if/user/#/settings;${JSON.stringify({ page: "page-sources" })}`,
                )}"
            >
                ${msg("Connect")}
            </a>`;
        }
        return html`${msg("-")}`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-user-settings-source-saml": SourceSettingsSAML;
    }
}
