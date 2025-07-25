import "#elements/CodeMirror";
import "#elements/ak-dual-select/ak-dual-select-provider";
import "#elements/forms/FormGroup";
import "#elements/forms/HorizontalFormElement";
import "#elements/forms/SearchSelect/index";

import { DEFAULT_CONFIG } from "#common/api/config";
import { docLink } from "#common/global";
import { groupBy } from "#common/utils";

import { DataProvider, DualSelectPair } from "#elements/ak-dual-select/types";
import { CodeMirrorMode } from "#elements/CodeMirror";
import { ModelForm } from "#elements/forms/ModelForm";
import { PaginatedResponse } from "#elements/table/Table";

import {
    Outpost,
    OutpostDefaultConfig,
    OutpostsApi,
    OutpostsServiceConnectionsAllListRequest,
    OutpostTypeEnum,
    ProvidersApi,
    ServiceConnection,
} from "@goauthentik/api";

import YAML from "yaml";

import { msg } from "@lit/localize";
import { html, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { map } from "lit/directives/map.js";

interface ProviderBase {
    pk: number;
    name: string;
    assignedBackchannelApplicationName?: string;
    assignedApplicationName?: string;
}

const api = () => new ProvidersApi(DEFAULT_CONFIG);
const providerListArgs = (page: number, search = "") => ({
    ordering: "name",
    applicationIsnull: false,
    pageSize: 20,
    search: search.trim(),
    page,
});

const dualSelectPairMaker = (item: ProviderBase): DualSelectPair => {
    const label =
        item.assignedBackchannelApplicationName || item.assignedApplicationName || item.name;

    return [
        `${item.pk}`,
        html`<div class="selection-main">${label}</div>
            <div class="selection-desc">${item.name}</div>`,
        label,
    ];
};

const provisionMaker = (results: PaginatedResponse<ProviderBase>) => ({
    pagination: results.pagination,
    options: results.results.map(dualSelectPairMaker),
});

const proxyListFetch = async (page: number, search = "") =>
    provisionMaker(await api().providersProxyList(providerListArgs(page, search)));

const ldapListFetch = async (page: number, search = "") =>
    provisionMaker(await api().providersLdapList(providerListArgs(page, search)));

const radiusListFetch = async (page: number, search = "") =>
    provisionMaker(await api().providersRadiusList(providerListArgs(page, search)));

const racListProvider = async (page: number, search = "") =>
    provisionMaker(await api().providersRacList(providerListArgs(page, search)));

function providerProvider(type: OutpostTypeEnum): DataProvider {
    switch (type) {
        case OutpostTypeEnum.Proxy:
            return proxyListFetch;
        case OutpostTypeEnum.Ldap:
            return ldapListFetch;
        case OutpostTypeEnum.Radius:
            return radiusListFetch;
        case OutpostTypeEnum.Rac:
            return racListProvider;
        default:
            throw new Error(`Unrecognized OutputType: ${type}`);
    }
}

@customElement("ak-outpost-form")
export class OutpostForm extends ModelForm<Outpost, string> {
    @property()
    type: OutpostTypeEnum = OutpostTypeEnum.Proxy;

    @property({ type: Boolean })
    embedded = false;

    @state()
    providers: DataProvider = providerProvider(this.type);

    defaultConfig?: OutpostDefaultConfig;

    async loadInstance(pk: string): Promise<Outpost> {
        const o = await new OutpostsApi(DEFAULT_CONFIG).outpostsInstancesRetrieve({
            uuid: pk,
        });
        this.type = o.type || OutpostTypeEnum.Proxy;
        this.providers = providerProvider(o.type);
        return o;
    }

    async load(): Promise<void> {
        this.defaultConfig = await new OutpostsApi(
            DEFAULT_CONFIG,
        ).outpostsInstancesDefaultSettingsRetrieve();
        this.providers = providerProvider(this.type);
    }

    getSuccessMessage(): string {
        return this.instance
            ? msg("Successfully updated outpost.")
            : msg("Successfully created outpost.");
    }

    async send(data: Outpost): Promise<Outpost> {
        if (this.instance) {
            return new OutpostsApi(DEFAULT_CONFIG).outpostsInstancesUpdate({
                uuid: this.instance.pk || "",
                outpostRequest: data,
            });
        }
        return new OutpostsApi(DEFAULT_CONFIG).outpostsInstancesCreate({
            outpostRequest: data,
        });
    }

    renderForm(): TemplateResult {
        const typeOptions = [
            [OutpostTypeEnum.Proxy, msg("Proxy")],
            [OutpostTypeEnum.Ldap, msg("LDAP")],
            [OutpostTypeEnum.Radius, msg("Radius")],
            [OutpostTypeEnum.Rac, msg("RAC")],
        ];

        return html` <ak-form-element-horizontal label=${msg("Name")} required name="name">
                <input
                    type="text"
                    value="${ifDefined(this.instance?.name)}"
                    class="pf-c-form-control"
                    required
                />
            </ak-form-element-horizontal>
            <ak-form-element-horizontal label=${msg("Type")} required name="type">
                <select
                    class="pf-c-form-control"
                    @change=${(ev: Event) => {
                        const target = ev.target as HTMLSelectElement;
                        this.type = target.selectedOptions[0].value as OutpostTypeEnum;
                        this.load();
                    }}
                >
                    ${map(
                        typeOptions,
                        ([instanceType, label]) =>
                            html` <option
                                value=${instanceType}
                                ?selected=${this.instance?.type === instanceType}
                            >
                                ${label}
                            </option>`,
                    )}
                </select>
            </ak-form-element-horizontal>
            <ak-form-element-horizontal label=${msg("Integration")} name="serviceConnection">
                <ak-search-select
                    .fetchObjects=${async (query?: string): Promise<ServiceConnection[]> => {
                        const args: OutpostsServiceConnectionsAllListRequest = {
                            ordering: "name",
                        };
                        if (query !== undefined) {
                            args.search = query;
                        }
                        const items = await new OutpostsApi(
                            DEFAULT_CONFIG,
                        ).outpostsServiceConnectionsAllList(args);
                        return items.results;
                    }}
                    .renderElement=${(item: ServiceConnection): string => {
                        return item.name;
                    }}
                    .value=${(item: ServiceConnection | undefined): string | undefined => {
                        return item?.pk;
                    }}
                    .groupBy=${(items: ServiceConnection[]) => {
                        return groupBy(items, (item) => item.verboseName);
                    }}
                    .selected=${(item: ServiceConnection, items: ServiceConnection[]): boolean => {
                        let selected = this.instance?.serviceConnection === item.pk;
                        if (items.length === 1 && !this.instance) {
                            selected = true;
                        }
                        return selected;
                    }}
                    blankable
                >
                </ak-search-select>
                <p class="pf-c-form__helper-text">
                    ${msg(
                        "Selecting an integration enables the management of the outpost by authentik.",
                    )}
                </p>
                <p class="pf-c-form__helper-text">
                    <a
                        target="_blank"
                        rel="noopener noreferrer"
                        href="${docLink("/docs/add-secure-apps/outposts?utm_source=authentik")}"
                        >${msg("See documentation")}</a
                    >.
                </p>
            </ak-form-element-horizontal>
            <ak-form-element-horizontal
                label=${msg("Applications")}
                ?required=${!this.embedded}
                name="providers"
            >
                <ak-dual-select-provider
                    .provider=${this.providers}
                    .selected=${(this.instance?.providersObj ?? []).map(dualSelectPairMaker)}
                    available-label="${msg("Available Applications")}"
                    selected-label="${msg("Selected Applications")}"
                ></ak-dual-select-provider>
            </ak-form-element-horizontal>
            <ak-form-group label=${msg("Advanced settings")}>
                <div class="pf-c-form">
                    <ak-form-element-horizontal label=${msg("Configuration")} name="config">
                        <ak-codemirror
                            mode=${CodeMirrorMode.YAML}
                            value="${YAML.stringify(
                                this.instance ? this.instance.config : this.defaultConfig?.config,
                            )}"
                        ></ak-codemirror>
                        <p class="pf-c-form__helper-text">
                            ${msg("Set custom attributes using YAML or JSON.")}
                        </p>
                        <p class="pf-c-form__helper-text">
                            ${msg("See more here:")}&nbsp;
                            <a
                                target="_blank"
                                rel="noopener noreferrer"
                                href="${docLink(
                                    "/docs/add-secure-apps/outposts?utm_source=authentik#configuration",
                                )}"
                                >${msg("Documentation")}</a
                            >
                        </p>
                    </ak-form-element-horizontal>
                </div>
            </ak-form-group>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-outpost-form": OutpostForm;
    }
}
