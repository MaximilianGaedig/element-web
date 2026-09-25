/*
Copyright 2026 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/*
 * The way in to people and calls.
 *
 * In the rail beside the room list, next to the other things that are not a room: it is a list of people, not
 * a conversation, so it does not belong in the room list itself. The dialog it opens is loaded when it is
 * first opened rather than with the app - nothing here is needed to show a chat, and startup is measured
 * (MEO-5).
 */

import React, { type JSX } from "react";
import { IconButton, Text, Tooltip } from "@vector-im/compound-web";
import UserProfileIcon from "@vector-im/compound-design-tokens/assets/web/icons/user-profile";

import { _t } from "../../../languageHandler";
import Modal from "../../../Modal";

export async function openContacts(initialTab: "people" | "calls" = "people"): Promise<void> {
    const { ContactsDialog } = await import("./ContactsDialog");
    Modal.createDialog(ContactsDialog, { initialTab });
}

export function ContactsButton({ isPanelCollapsed = false }: { isPanelCollapsed?: boolean }): JSX.Element {
    const button = (
        <IconButton
            className="mx_ContactsButton"
            aria-label={_t("contacts|title")}
            onClick={() => void openContacts()}
            indicator={undefined}
        >
            {/* One child only: Compound's IconButton passes it through React.Children.only, so an icon
                plus a label has to arrive as a single fragment - the same thing QuickSettingsButton does. */}
            <>
                <UserProfileIcon />
                {!isPanelCollapsed && (
                    <Text className="mx_ContactsButton_label" as="span" size="md" title={_t("contacts|title")}>
                        {_t("contacts|people")}
                    </Text>
                )}
            </>
        </IconButton>
    );

    // Collapsed, the icon alone has to say what it is; expanded, the label already does.
    return isPanelCollapsed ? (
        <Tooltip label={_t("contacts|title")} placement="right">
            {button}
        </Tooltip>
    ) : (
        button
    );
}

export default ContactsButton;
