import { WithBrandConfig } from "#elements/mixins/branding";
import { CapabilitiesEnum, WithCapabilitiesConfig } from "#elements/mixins/capabilities";
import "@goauthentik/admin/users/ServiceAccountForm";
import "@goauthentik/admin/users/UserActiveForm";
import "@goauthentik/admin/users/UserForm";
import "@goauthentik/admin/users/UserImpersonateForm";
import "@goauthentik/admin/users/UserPasswordForm";
import "@goauthentik/admin/users/UserResetEmailForm";
import { DEFAULT_CONFIG } from "@goauthentik/common/api/config";
import { PFSize } from "@goauthentik/common/enums.js";
import { parseAPIResponseError, pluckErrorDetail } from "@goauthentik/common/errors/network";
import { MessageLevel } from "@goauthentik/common/messages";
import { formatElapsedTime } from "@goauthentik/common/temporal";
import { me } from "@goauthentik/common/users";
import "@goauthentik/components/ak-status-label";
import "@goauthentik/elements/buttons/ActionButton";
import "@goauthentik/elements/buttons/Dropdown";
import "@goauthentik/elements/forms/DeleteBulkForm";
import { Form } from "@goauthentik/elements/forms/Form";
import "@goauthentik/elements/forms/HorizontalFormElement";
import "@goauthentik/elements/forms/ModalForm";
import { showMessage } from "@goauthentik/elements/messages/MessageContainer";
import { getURLParam, updateURLParams } from "@goauthentik/elements/router/RouteMatch";
import { PaginatedResponse } from "@goauthentik/elements/table/Table";
import { Table, TableColumn } from "@goauthentik/elements/table/Table";
import { UserOption } from "@goauthentik/elements/user/utils";
import "@patternfly/elements/pf-tooltip/pf-tooltip.js";

import { msg, str } from "@lit/localize";
import { CSSResult, TemplateResult, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ifDefined } from "lit/directives/if-defined.js";

import PFAlert from "@patternfly/patternfly/components/Alert/alert.css";
import PFBanner from "@patternfly/patternfly/components/Banner/banner.css";
import PFDescriptionList from "@patternfly/patternfly/components/DescriptionList/description-list.css";

import { CoreApi, CoreUsersListTypeEnum, Group, SessionUser, User } from "@goauthentik/api";

@customElement("ak-user-related-add")
export class RelatedUserAdd extends Form<{ users: number[] }> {
    @property({ attribute: false })
    group?: Group;

    @state()
    usersToAdd: User[] = [];

    getSuccessMessage(): string {
        return msg("Successfully added user(s).");
    }

    async send(data: { users: number[] }): Promise<{ users: number[] }> {
        await Promise.all(
            data.users.map((user) => {
                return new CoreApi(DEFAULT_CONFIG).coreGroupsAddUserCreate({
                    groupUuid: this.group?.pk || "",
                    userAccountRequest: {
                        pk: user,
                    },
                });
            }),
        );
        return data;
    }

    renderForm(): TemplateResult {
        return html` <ak-form-element-horizontal label=${msg("Users to add")} name="users">
            <div class="pf-c-input-group">
                <ak-group-member-select-table
                    .confirm=${(items: User[]) => {
                        this.usersToAdd = items;
                        this.requestUpdate();
                        return Promise.resolve();
                    }}
                >
                    <button slot="trigger" class="pf-c-button pf-m-control" type="button">
                        <pf-tooltip position="top" content=${msg("Add users")}>
                            <i class="fas fa-plus" aria-hidden="true"></i>
                        </pf-tooltip>
                    </button>
                </ak-group-member-select-table>
                <div class="pf-c-form-control">
                    <ak-chip-group>
                        ${this.usersToAdd.map((user) => {
                            return html`<ak-chip
                                removable
                                value=${ifDefined(user.pk)}
                                @remove=${() => {
                                    const idx = this.usersToAdd.indexOf(user);
                                    this.usersToAdd.splice(idx, 1);
                                    this.requestUpdate();
                                }}
                            >
                                ${UserOption(user)}
                            </ak-chip>`;
                        })}
                    </ak-chip-group>
                </div>
            </div>
        </ak-form-element-horizontal>`;
    }
}

@customElement("ak-user-related-list")
export class RelatedUserList extends WithBrandConfig(WithCapabilitiesConfig(Table<User>)) {
    expandable = true;
    checkbox = true;
    clearOnRefresh = true;

    searchEnabled(): boolean {
        return true;
    }

    @property({ attribute: false })
    targetGroup?: Group;

    @property()
    order = "last_login";

    @property({ type: Boolean })
    hideServiceAccounts = getURLParam<boolean>("hideServiceAccounts", true);

    @state()
    me?: SessionUser;

    static get styles(): CSSResult[] {
        return Table.styles.concat(PFDescriptionList, PFAlert, PFBanner);
    }

    async apiEndpoint(): Promise<PaginatedResponse<User>> {
        const users = await new CoreApi(DEFAULT_CONFIG).coreUsersList({
            ...(await this.defaultEndpointConfig()),
            groupsByPk: this.targetGroup ? [this.targetGroup.pk] : [],
            type: this.hideServiceAccounts
                ? [CoreUsersListTypeEnum.External, CoreUsersListTypeEnum.Internal]
                : undefined,
            includeGroups: false,
        });
        this.me = await me();
        return users;
    }

    columns(): TableColumn[] {
        return [
            new TableColumn(msg("Name"), "username"),
            new TableColumn(msg("Active"), "is_active"),
            new TableColumn(msg("Last login"), "last_login"),
            new TableColumn(msg("Actions")),
        ];
    }

    renderToolbarSelected(): TemplateResult {
        const disabled = this.selectedElements.length < 1;
        return html`<ak-forms-delete-bulk
            objectLabel=${msg("User(s)")}
            actionLabel=${msg("Remove Users(s)")}
            action=${msg("removed")}
            actionSubtext=${msg(
                str`Are you sure you want to remove the selected users from the group ${this.targetGroup?.name}?`,
            )}
            .objects=${this.selectedElements}
            .metadata=${(item: User) => {
                return [
                    { key: msg("Username"), value: item.username },
                    { key: msg("ID"), value: item.pk.toString() },
                    { key: msg("UID"), value: item.uid },
                ];
            }}
            .delete=${(item: User) => {
                return new CoreApi(DEFAULT_CONFIG).coreGroupsRemoveUserCreate({
                    groupUuid: this.targetGroup?.pk || "",
                    userAccountRequest: {
                        pk: item.pk,
                    },
                });
            }}
        >
            <button ?disabled=${disabled} slot="trigger" class="pf-c-button pf-m-danger">
                ${msg("Remove")}
            </button>
        </ak-forms-delete-bulk>`;
    }

    row(item: User): TemplateResult[] {
        const canImpersonate =
            this.can(CapabilitiesEnum.CanImpersonate) && item.pk !== this.me?.user.pk;
        return [
            html`<a href="#/identity/users/${item.pk}">
                <div>${item.username}</div>
                <small>${item.name}</small>
            </a>`,
            html`<ak-status-label ?good=${item.isActive}></ak-status-label>`,
            html`${item.lastLogin
                ? html`<div>${formatElapsedTime(item.lastLogin)}</div>
                      <small>${item.lastLogin.toLocaleString()}</small>`
                : msg("-")}`,
            html`<ak-forms-modal>
                    <span slot="submit"> ${msg("Update")} </span>
                    <span slot="header"> ${msg("Update User")} </span>
                    <ak-user-form slot="form" .instancePk=${item.pk}> </ak-user-form>
                    <button slot="trigger" class="pf-c-button pf-m-plain">
                        <pf-tooltip position="top" content=${msg("Edit")}>
                            <i class="fas fa-edit"></i>
                        </pf-tooltip>
                    </button>
                </ak-forms-modal>
                ${canImpersonate
                    ? html`
                          <ak-forms-modal size=${PFSize.Medium} id="impersonate-request">
                              <span slot="submit">${msg("Impersonate")}</span>
                              <span slot="header">${msg("Impersonate")} ${item.username}</span>
                              <ak-user-impersonate-form
                                  slot="form"
                                  .instancePk=${item.pk}
                              ></ak-user-impersonate-form>
                              <button slot="trigger" class="pf-c-button pf-m-tertiary">
                                  <pf-tooltip
                                      position="top"
                                      content=${msg("Temporarily assume the identity of this user")}
                                  >
                                      <span>${msg("Impersonate")}</span>
                                  </pf-tooltip>
                              </button>
                          </ak-forms-modal>
                      `
                    : html``}`,
        ];
    }

    renderExpanded(item: User): TemplateResult {
        return html`<td role="cell" colspan="3">
                <div class="pf-c-table__expandable-row-content">
                    <dl class="pf-c-description-list pf-m-horizontal">
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">
                                <span class="pf-c-description-list__text"
                                    >${msg("User status")}</span
                                >
                            </dt>
                            <dd class="pf-c-description-list__description">
                                <div class="pf-c-description-list__text">
                                    ${item.isActive ? msg("Active") : msg("Inactive")}
                                </div>
                                <div class="pf-c-description-list__text">
                                    ${item.isSuperuser ? msg("Superuser") : msg("Regular user")}
                                </div>
                            </dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">
                                <span class="pf-c-description-list__text"
                                    >${msg("Change status")}</span
                                >
                            </dt>
                            <dd class="pf-c-description-list__description">
                                <div class="pf-c-description-list__text">
                                    <ak-user-active-form
                                        .obj=${item}
                                        objectLabel=${msg("User")}
                                        .delete=${() => {
                                            return new CoreApi(
                                                DEFAULT_CONFIG,
                                            ).coreUsersPartialUpdate({
                                                id: item.pk || 0,
                                                patchedUserRequest: {
                                                    isActive: !item.isActive,
                                                },
                                            });
                                        }}
                                    >
                                        <button slot="trigger" class="pf-c-button pf-m-warning">
                                            ${item.isActive ? msg("Deactivate") : msg("Activate")}
                                        </button>
                                    </ak-user-active-form>
                                </div>
                            </dd>
                        </div>
                        <div class="pf-c-description-list__group">
                            <dt class="pf-c-description-list__term">
                                <span class="pf-c-description-list__text">${msg("Recovery")}</span>
                            </dt>
                            <dd class="pf-c-description-list__description">
                                <div class="pf-c-description-list__text">
                                    <ak-forms-modal>
                                        <span slot="submit">${msg("Update password")}</span>
                                        <span slot="header">${msg("Update password")}</span>
                                        <ak-user-password-form
                                            slot="form"
                                            .instancePk=${item.pk}
                                        ></ak-user-password-form>
                                        <button slot="trigger" class="pf-c-button pf-m-secondary">
                                            ${msg("Set password")}
                                        </button>
                                    </ak-forms-modal>
                                    ${this.brand.flowRecovery
                                        ? html`
                                              <ak-action-button
                                                  class="pf-m-secondary"
                                                  .apiRequest=${() => {
                                                      return new CoreApi(DEFAULT_CONFIG)
                                                          .coreUsersRecoveryCreate({
                                                              id: item.pk,
                                                          })
                                                          .then((rec) => {
                                                              showMessage({
                                                                  level: MessageLevel.success,
                                                                  message: msg(
                                                                      "Successfully generated recovery link",
                                                                  ),
                                                                  description: rec.link,
                                                              });
                                                          })
                                                          .catch(async (error: unknown) => {
                                                              const parsedError =
                                                                  await parseAPIResponseError(
                                                                      error,
                                                                  );

                                                              showMessage({
                                                                  level: MessageLevel.error,
                                                                  message:
                                                                      pluckErrorDetail(parsedError),
                                                              });
                                                          });
                                                  }}
                                              >
                                                  ${msg("Copy recovery link")}
                                              </ak-action-button>
                                              ${item.email
                                                  ? html`<ak-forms-modal
                                                        .closeAfterSuccessfulSubmit=${false}
                                                    >
                                                        <span slot="submit">
                                                            ${msg("Send link")}
                                                        </span>
                                                        <span slot="header">
                                                            ${msg("Send recovery link to user")}
                                                        </span>
                                                        <ak-user-reset-email-form
                                                            slot="form"
                                                            .user=${item}
                                                        >
                                                        </ak-user-reset-email-form>
                                                        <button
                                                            slot="trigger"
                                                            class="pf-c-button pf-m-secondary"
                                                        >
                                                            ${msg("Email recovery link")}
                                                        </button>
                                                    </ak-forms-modal>`
                                                  : html`<span
                                                        >${msg(
                                                            "Recovery link cannot be emailed, user has no email address saved.",
                                                        )}</span
                                                    >`}
                                          `
                                        : html` <p>
                                              ${msg(
                                                  "To let a user directly reset a their password, configure a recovery flow on the currently active brand.",
                                              )}
                                          </p>`}
                                </div>
                            </dd>
                        </div>
                    </dl>
                </div>
            </td>
            <td></td>
            <td></td>`;
    }

    renderToolbar(): TemplateResult {
        return html`
            ${this.targetGroup
                ? html`<ak-forms-modal>
                      <span slot="submit"> ${msg("Add")} </span>
                      <span slot="header"> ${msg("Add User")} </span>
                      ${this.targetGroup.isSuperuser
                          ? html`
                                <div class="pf-c-banner pf-m-warning" slot="above-form">
                                    ${msg(
                                        "Warning: This group is configured with superuser access. Added users will have superuser access.",
                                    )}
                                </div>
                            `
                          : html``}
                      <ak-user-related-add .group=${this.targetGroup} slot="form">
                      </ak-user-related-add>
                      <button slot="trigger" class="pf-c-button pf-m-primary">
                          ${msg("Add existing user")}
                      </button>
                  </ak-forms-modal>`
                : html``}
            <ak-dropdown class="pf-c-dropdown">
                <button class="pf-m-secondary pf-c-dropdown__toggle" type="button">
                    <span class="pf-c-dropdown__toggle-text">${msg("Create user")}</span>
                    <i class="fas fa-caret-down pf-c-dropdown__toggle-icon" aria-hidden="true"></i>
                </button>
                <ul class="pf-c-dropdown__menu" hidden>
                    <li>
                        <ak-forms-modal>
                            <span slot="submit"> ${msg("Create")} </span>
                            <span slot="header"> ${msg("Create User")} </span>
                            ${this.targetGroup
                                ? html`
                                      <div class="pf-c-banner pf-m-info" slot="above-form">
                                          ${msg(
                                              str`This user will be added to the group "${this.targetGroup.name}".`,
                                          )}
                                      </div>
                                  `
                                : nothing}
                            <ak-user-form .group=${this.targetGroup} slot="form"> </ak-user-form>
                            <a slot="trigger" class="pf-c-dropdown__menu-item">
                                ${msg("Create user")}
                            </a>
                        </ak-forms-modal>
                    </li>
                    <li>
                        <ak-forms-modal
                            .closeAfterSuccessfulSubmit=${false}
                            .cancelText=${msg("Close")}
                        >
                            <span slot="submit"> ${msg("Create")} </span>
                            <span slot="header"> ${msg("Create Service account")} </span>
                            ${this.targetGroup
                                ? html`
                                      <div class="pf-c-banner pf-m-info" slot="above-form">
                                          ${msg(
                                              str`This user will be added to the group "${this.targetGroup.name}".`,
                                          )}
                                      </div>
                                  `
                                : nothing}
                            <ak-user-service-account-form .group=${this.targetGroup} slot="form">
                            </ak-user-service-account-form>
                            <a slot="trigger" class="pf-c-dropdown__menu-item">
                                ${msg("Create Service account")}
                            </a>
                        </ak-forms-modal>
                    </li>
                </ul>
            </ak-dropdown>
            ${super.renderToolbar()}
        `;
    }

    renderToolbarAfter(): TemplateResult {
        return html`&nbsp;
            <div class="pf-c-toolbar__group pf-m-filter-group">
                <div class="pf-c-toolbar__item pf-m-search-filter">
                    <div class="pf-c-input-group">
                        <label class="pf-c-switch">
                            <input
                                class="pf-c-switch__input"
                                type="checkbox"
                                ?checked=${this.hideServiceAccounts}
                                @change=${() => {
                                    this.hideServiceAccounts = !this.hideServiceAccounts;
                                    this.page = 1;
                                    this.fetch();
                                    updateURLParams({
                                        hideServiceAccounts: this.hideServiceAccounts,
                                    });
                                }}
                            />
                            <span class="pf-c-switch__toggle">
                                <span class="pf-c-switch__toggle-icon">
                                    <i class="fas fa-check" aria-hidden="true"></i>
                                </span>
                            </span>
                            <span class="pf-c-switch__label">${msg("Hide service-accounts")}</span>
                        </label>
                    </div>
                </div>
            </div>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        "ak-user-related-list": RelatedUserList;
        "ak-user-related-add": RelatedUserAdd;
    }
}
